import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EvalFilterNoMatchError,
  EveCliAdapter,
  type EveEvalRunSummary,
  outerSuiteTimeoutMs,
  runCommand,
  stableStringify,
  summaryToRunRecord,
} from "./eve.js";

const fixturePath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "__fixtures__",
  "eval-summary.json",
);

function loadSummary(): EveEvalRunSummary {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as EveEvalRunSummary;
}

const ctx = {
  ref: "head",
  commitSha: "abc123def4567890abc123def4567890abc123de",
  runIndex: 2,
  eveVersion: "0.29.5-probe",
  sandboxBackend: "docker" as const,
};

describe("summaryToRunRecord", () => {
  it("maps the full RunRecord from a synthetic summary", () => {
    const record = summaryToRunRecord(loadSummary(), ctx);

    expect(record.ref).toBe("head");
    expect(record.commitSha).toBe(ctx.commitSha);
    expect(record.runIndex).toBe(2);

    // Eval results and checks
    expect(record.evalResults).toHaveLength(2);
    const [alpha, beta] = record.evalResults;
    expect(alpha?.name).toBe("revenue/alpha");
    expect(alpha?.passed).toBe(true);
    expect(alpha?.durationMs).toBe(4500);
    expect(alpha?.checks).toEqual([
      { name: "succeeded", passed: true, score: 1 },
      {
        name: "judge.autoevals.factuality",
        passed: true,
        score: 0.8,
      },
    ]);
    expect(beta?.name).toBe("revenue/beta");
    expect(beta?.passed).toBe(false);
    expect(beta?.checks).toEqual([{ name: "calledTool(run_sql)", passed: false, score: 0 }]);

    // Tool calls: global order across evals, sorted by turnIndex within an
    // eval (the fixture lists run_sql before load_skill but at a later turn).
    expect(record.toolCalls.map((call) => [call.name, call.order, call.evalName])).toEqual([
      ["load_skill", 0, "revenue/alpha"],
      ["run_sql", 1, "revenue/alpha"],
      ["run_sql", 2, "revenue/beta"],
    ]);

    // Inputs are hashed, never stored raw.
    for (const call of record.toolCalls) {
      expect(call.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    }
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("SELECT 1");
    expect(serialized).not.toContain("SELECT 2");
    expect(serialized).not.toContain("close enough");
    const [alphaSql, betaSql] = [record.toolCalls[1], record.toolCalls[2]];
    expect(alphaSql?.inputsHash).not.toBe(betaSql?.inputsHash);

    // Skills derive from load_skill tool calls.
    expect(record.skillsLoaded).toEqual(["revenue-definitions"]);
    expect(record.skillLoads).toEqual([{ name: "revenue-definitions", evalName: "revenue/alpha" }]);

    // Subagent delegations.
    expect(record.subagentCalls).toEqual([
      { name: "reporter", order: 0, evalName: "revenue/beta" },
    ]);

    // Tokens folded from step.completed usage across both evals.
    expect(record.tokens).toEqual({ input: 340, output: 120, cacheRead: 0, cacheWrite: 0 });

    // A later usage-bearing step has no gateway cost, so the partial $0.0046 is rejected.
    expect(record.costUsd).toBeNull();

    expect(record.durationMs).toBe(10_000);
    expect(record.startedAt).toBe("2026-08-03T10:00:00.000Z");

    // Identity from runtimeIdentity of the first result that carries it.
    expect(record.model).toBe("anthropic/claude-sonnet-5");
    expect(record.eveVersion).toBe("0.29.5");

    expect(record.sandboxBackend).toBe("docker");
    expect(record.dataSources).toEqual({ evalJson: true, spans: false, logs: false });
  });

  it("reports costUsd null when no step carries a gateway cost", () => {
    const summary = loadSummary();
    for (const result of summary.results ?? []) {
      for (const event of result.result?.events ?? []) {
        if (event.data?.usage !== undefined) {
          const { costUsd: _cost, ...usageRest } = event.data.usage;
          event.data.usage = usageRest;
        }
      }
    }
    const record = summaryToRunRecord(summary, ctx);
    expect(record.costUsd).toBeNull();
    // Tokens still fold.
    expect(record.tokens).toEqual({ input: 340, output: 120, cacheRead: 0, cacheWrite: 0 });
  });

  it("rejects a partial gateway total when any usage-bearing step lacks cost", () => {
    const summary = loadSummary();
    const usageEvents = (summary.results ?? []).flatMap((result) =>
      (result.result?.events ?? []).filter((event) => event.data?.usage !== undefined),
    );
    const firstUsage = usageEvents[0]?.data?.usage;
    if (firstUsage === undefined) throw new Error("fixture must contain usage");
    const { costUsd: _cost, ...usageWithoutCost } = firstUsage;
    if (usageEvents[0]?.data) usageEvents[0].data.usage = usageWithoutCost;

    expect(summaryToRunRecord(summary, ctx).costUsd).toBeNull();
  });

  it("falls back to probe eveVersion and model 'unknown' without runtimeIdentity", () => {
    const summary = loadSummary();
    for (const result of summary.results ?? []) {
      if (result.result !== undefined) {
        const { runtimeIdentity: _identity, ...resultRest } = result.result;
        result.result = resultRest;
      }
    }
    const record = summaryToRunRecord(summary, ctx);
    expect(record.model).toBe("unknown");
    expect(record.eveVersion).toBe("0.29.5-probe");
  });

  it("falls back to the model captured by eve info when runtimeIdentity omits modelId", () => {
    const summary = loadSummary();
    for (const result of summary.results ?? []) {
      if (result.result?.runtimeIdentity !== undefined) {
        delete result.result.runtimeIdentity.modelId;
      }
    }
    const record = summaryToRunRecord(summary, { ...ctx, model: "openai/gpt-5.6-luna-fast" });
    expect(record.model).toBe("openai/gpt-5.6-luna-fast");
    expect(record.eveVersion).toBe("0.29.5");
  });

  it("stores per-eval fingerprints plus a compatibility aggregate without raw outputs", () => {
    const summary = loadSummary();
    const outputs = ["secret answer alpha", "secret answer beta"];
    for (const [index, result] of (summary.results ?? []).entries()) {
      if (result.result !== undefined) result.result.finalMessage = outputs[index];
    }
    const record = summaryToRunRecord(summary, ctx);
    expect(record.finalOutput?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.finalOutput?.length).toBe(outputs.join("").length);
    expect(record.evalResults.map((result) => result.finalOutput?.length)).toEqual(
      outputs.map((output) => output.length),
    );
    expect(JSON.stringify(record)).not.toContain("secret answer");
  });

  it("adds delegated child usage exactly once and refuses a partial root-only gateway cost", () => {
    const summary: EveEvalRunSummary = {
      results: [
        {
          id: "delegation",
          verdict: "passed",
          result: {
            events: [
              {
                type: "step.completed",
                data: {
                  usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    cacheReadTokens: 2,
                    cacheWriteTokens: 1,
                    costUsd: 0.01,
                  },
                },
              },
              {
                type: "action.result",
                data: {
                  result: {
                    kind: "subagent-result",
                    usage: {
                      inputTokens: 100,
                      outputTokens: 50,
                      cacheReadTokens: 20,
                      cacheWriteTokens: 10,
                    },
                    // Same child turn represented a second way; must not be double-counted.
                    outcome: {
                      usageDelta: {
                        inputTokens: 999,
                        outputTokens: 999,
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    };
    const record = summaryToRunRecord(summary, ctx);
    // Eve/AI SDK inputTokens includes cached input; normalized input is the non-cache remainder.
    expect(record.tokens).toEqual({ input: 77, output: 55, cacheRead: 22, cacheWrite: 11 });
    expect(record.costUsd).toBeNull();
    expect(record.pricingModel).toBeNull();
  });

  it("refuses fallback pricing when usage-bearing steps use multiple models", () => {
    const summary: EveEvalRunSummary = {
      results: [
        {
          id: "dynamic-models",
          verdict: "passed",
          result: {
            runtimeIdentity: { modelId: "openai/gpt-5", eveVersion: "0.47.5" },
            events: [
              {
                type: "step.started",
                data: { modelId: "openai/gpt-5", turnId: "turn-1", stepIndex: 0 },
              },
              {
                type: "step.completed",
                data: {
                  turnId: "turn-1",
                  stepIndex: 0,
                  usage: { inputTokens: 10, outputTokens: 2 },
                },
              },
              {
                type: "step.started",
                data: { modelId: "anthropic/claude-sonnet-5", turnId: "turn-1", stepIndex: 1 },
              },
              {
                type: "step.completed",
                data: {
                  turnId: "turn-1",
                  stepIndex: 1,
                  usage: { inputTokens: 20, outputTokens: 4 },
                },
              },
            ],
          },
        },
      ],
    };

    const record = summaryToRunRecord(summary, ctx);
    expect(record.model).toBe("anthropic/claude-sonnet-5 / openai/gpt-5");
    expect(record.pricingModel).toBeNull();
    expect(record.tokens).toEqual({ input: 30, output: 6, cacheRead: 0, cacheWrite: 0 });
  });

  it("tolerates an empty summary", () => {
    const record = summaryToRunRecord({}, ctx);
    expect(record.evalResults).toEqual([]);
    expect(record.toolCalls).toEqual([]);
    expect(record.skillsLoaded).toEqual([]);
    expect(record.subagentCalls).toEqual([]);
    expect(record.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record.costUsd).toBeNull();
    expect(record.model).toBe("unknown");
  });
});

describe("EveCliAdapter compatibility", () => {
  it("rejects an unmatched eval filter before starting an eval run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "diff0-eve-filter-miss-"));
    const binDir = join(cwd, "node_modules", ".bin");
    const bin = join(binDir, "eve");
    const runMarker = join(cwd, "eval-ran");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("0.47.5");
else if (args === "eval --list --json") console.log(JSON.stringify([{ id: "suite/one" }]));
else if (args === "info --json") console.log(JSON.stringify({ model: "mock/model" }));
else if (args.startsWith("eval --json --skip-report")) { fs.writeFileSync(${JSON.stringify(runMarker)}, "ran"); process.exit(2); }
else process.exit(2);
`,
    );
    chmodSync(bin, 0o755);

    try {
      await expect(
        new EveCliAdapter().runEvalSuite("head", "abc123", {
          cwd,
          runIndex: 0,
          evalFilter: ["missing"],
        }),
      ).rejects.toBeInstanceOf(EvalFilterNoMatchError);
      expect(existsSync(runMarker)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a suite result that silently omits a probed eval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "diff0-eve-missing-result-"));
    const binDir = join(cwd, "node_modules", ".bin");
    const bin = join(binDir, "eve");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("0.47.5");
else if (args === "eval --list --json") console.log(JSON.stringify([{ id: "suite/one" }, { id: "suite/two" }]));
else if (args === "info --json") console.log(JSON.stringify({ model: "mock/model", skills: [], tools: [], subagents: [] }));
else if (args.startsWith("eval --json --skip-report")) console.log(JSON.stringify({ results: [{ id: "suite/one", verdict: "passed", assertions: [] }] }));
else process.exit(2);
`,
    );
    chmodSync(bin, 0o755);

    try {
      await expect(
        new EveCliAdapter().runEvalSuite("head", "abc123", {
          cwd,
          runIndex: 0,
          evalFilter: [],
        }),
      ).rejects.toThrow(/missing: suite\/two/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not misreport malformed eval configuration as an empty suite", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "diff0-eve-broken-config-"));
    const binDir = join(cwd, "node_modules", ".bin");
    const bin = join(binDir, "eve");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("0.47.5");
else if (args === "eval --list --json") { console.error("SyntaxError: invalid evals.config.ts"); process.exit(2); }
else process.exit(2);
`,
    );
    chmodSync(bin, 0o755);

    try {
      await expect(new EveCliAdapter().probe(cwd)).rejects.toThrow(
        /failed.*exit 2.*SyntaxError: invalid evals\.config\.ts/s,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses eve info model identity with Eve summaries that omit modelId", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "diff0-eve-adapter-"));
    const binDir = join(cwd, "node_modules", ".bin");
    const bin = join(binDir, "eve");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("0.47.5");
else if (args === "eval --list --json") console.log(JSON.stringify([{ id: "compat/eval" }]));
else if (args === "info --json") console.log(JSON.stringify({ model: "openai/gpt-5.6-luna-fast", skills: [], tools: [], subagents: [] }));
else if (args.startsWith("eval --json --skip-report")) console.log(JSON.stringify({ results: [{ id: "compat/eval", verdict: "passed", result: { finalMessage: "private response", events: [], derived: {}, runtimeIdentity: { eveVersion: "0.47.5" } } }], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" }));
else process.exit(2);
`,
    );
    chmodSync(bin, 0o755);

    try {
      const adapter = new EveCliAdapter();
      await expect(adapter.probe(cwd)).resolves.toEqual({
        eveVersion: "0.47.5",
        evalIds: ["compat/eval"],
      });
      const record = await adapter.runEvalSuite("head", "abc123", {
        cwd,
        runIndex: 0,
        evalFilter: [],
      });
      expect(record.model).toBe("openai/gpt-5.6-luna-fast");
      expect(record.eveVersion).toBe("0.47.5");
      expect(record.finalOutput?.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(record)).not.toContain("private response");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("runCommand", () => {
  it("preserves UTF-8 characters split across process output chunks", async () => {
    const script = `
const bytes = Buffer.from("A😀B", "utf8");
let index = 0;
const write = () => {
  if (index === bytes.length) return;
  process.stdout.write(bytes.subarray(index, index + 1));
  index += 1;
  setTimeout(write, 5);
};
write();
`;
    const result = await runCommand(process.execPath, ["-e", script], { cwd: process.cwd() });
    expect(result.stdout).toBe("A😀B");
  });

  it("enforces an outer timeout and settles once after terminating the child", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        cwd: process.cwd(),
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/timed out after 25ms/);
  });

  it("terminates commands whose combined output exceeds the configured bound", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], {
        cwd: process.cwd(),
        maxOutputBytes: 64,
      }),
    ).rejects.toThrow(/exceeded the 64-byte combined output limit/);
  });

  it.skipIf(process.platform === "win32")(
    "kills descendants in the detached process group when the parent exits",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "diff0-process-tree-"));
      const pidPath = join(cwd, "descendant.pid");
      const script = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(process.argv[1], String(child.pid));
process.stdout.write("ready".repeat(1024));
setInterval(() => {}, 1000);
`;
      try {
        await expect(
          runCommand(process.execPath, ["-e", script, pidPath], {
            cwd,
            maxOutputBytes: 64,
          }),
        ).rejects.toThrow(/output limit/);
        const descendantPid = Number(readFileSync(pidPath, "utf8"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(() => process.kill(descendantPid, 0)).toThrow();
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "forwards parent SIGTERM to the detached child process group",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "diff0-parent-signal-"));
      const pidPath = join(cwd, "pids.json");
      const donePath = join(cwd, "done.txt");
      const eveModuleUrl = new URL("./eve.ts", import.meta.url).href;
      const nestedScript = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(process.argv[1], JSON.stringify({ direct: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`;
      const helperScript = `
import { writeFileSync } from "node:fs";
import { runCommand } from ${JSON.stringify(eveModuleUrl)};
try {
  await runCommand(process.execPath, ["-e", ${JSON.stringify(nestedScript)}, ${JSON.stringify(pidPath)}], {
    cwd: ${JSON.stringify(cwd)},
  });
  process.exitCode = 2;
} catch (error) {
  writeFileSync(${JSON.stringify(donePath)}, error instanceof Error ? error.message : String(error));
}
`;
      const helper = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", helperScript],
        { cwd: process.cwd(), stdio: "ignore" },
      );

      const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (!predicate()) {
          if (Date.now() >= deadline) throw new Error("timed out waiting for subprocess state");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      try {
        await waitFor(() => existsSync(pidPath));
        if (helper.pid === undefined) throw new Error("helper process has no pid");
        process.kill(helper.pid, "SIGTERM");
        const helperExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => helper.once("close", (code, signal) => resolve({ code, signal })),
        );
        const exited = await helperExit;
        expect(exited).toEqual({ code: 0, signal: null });
        await waitFor(() => existsSync(donePath));
        expect(readFileSync(donePath, "utf8")).toContain("interrupted by SIGTERM");

        const pids = JSON.parse(readFileSync(pidPath, "utf8")) as {
          direct: number;
          descendant: number;
        };
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(() => process.kill(pids.direct, 0)).toThrow();
        expect(() => process.kill(pids.descendant, 0)).toThrow();
      } finally {
        if (helper.exitCode === null && helper.pid !== undefined) {
          try {
            process.kill(helper.pid, "SIGKILL");
          } catch {
            // Helper already exited.
          }
        }
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
});

describe("outerSuiteTimeoutMs", () => {
  it("allows each selected eval its per-eval budget plus process overhead", () => {
    expect(outerSuiteTimeoutMs(30_000, 4)).toBe(240_000);
  });

  it("uses a finite default even when eve's per-eval timeout is not overridden", () => {
    expect(outerSuiteTimeoutMs(undefined, 100)).toBe(30 * 60_000);
  });
});

describe("stableStringify", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("distinguishes different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("normalizes null and undefined", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify({ a: undefined, b: 1 })).toBe(stableStringify({ b: 1 }));
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
