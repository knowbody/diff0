import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { getDiff0Version } from "./collect/cache.js";
import type { EveAdapter, RunOptions, RunRecord } from "./types.js";

describe("diff0 CLI metadata", () => {
  it("prints the installed package version", async () => {
    let stdout = "";
    const code = await runCli(["node", "diff0", "--version"], {
      out: (text) => {
        stdout += text;
      },
      err: () => {},
    });

    expect(code).toBe(0);
    expect(stdout.trim()).toBe(getDiff0Version());
  });
});

describe("diff0 CLI app-dir usage errors", () => {
  async function cli(
    args: string[],
    createWorktree?: NonNullable<Parameters<typeof runCli>[2]>["createWorktree"],
  ): Promise<{ code: number; stderr: string }> {
    let stderr = "";
    const code = await runCli(
      ["node", "diff0", ...args],
      {
        out: () => {},
        err: (text) => {
          stderr += text;
        },
      },
      {
        resolveRef: async () => "a".repeat(40),
        ...(createWorktree !== undefined ? { createWorktree } : {}),
      },
    );
    return { code, stderr };
  }

  it.each([
    ["an escaping path", "../outside", "app-dir must stay within the target repository"],
    ["a NUL byte", "bad\0path", "app-dir contains a NUL byte"],
  ])("classifies %s as usage exit 2", async (_case, appDir, message) => {
    const result = await cli(["estimate", "--base", "main", "--app-dir", appDir]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it.each([
    ["does not exist", 'app-dir does not exist in the target repository (got "missing")'],
    ["is not a directory", 'app-dir must identify a directory (got "not-a-directory")'],
  ])("classifies an app dir that %s as usage exit 2", async (_case, message) => {
    const appDir = message.includes("does not exist") ? "missing" : "not-a-directory";
    const result = await cli(["estimate", "--base", "main", "--app-dir", appDir], async () => {
      throw new Error(message);
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it("classifies a missing --app-dir value as usage exit 2", async () => {
    const result = await cli(["estimate", "--base", "main", "--app-dir"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("option '--app-dir <path>' argument missing");
  });
});

function performanceRecord(
  ref: string,
  commitSha: string,
  runIndex: number,
  scale: number,
): RunRecord {
  return {
    ref,
    commitSha,
    runIndex,
    evalResults: [{ name: "eval/pass", passed: true, checks: [] }],
    toolCalls: [],
    skillLoads: [],
    skillsLoaded: [],
    subagentCalls: [],
    tokens: {
      input: Math.round(100 * scale),
      output: Math.round(100 * scale),
      cacheRead: 0,
      cacheWrite: 0,
    },
    costUsd: 0.1 * scale,
    durationMs: 1_000 * scale,
    sandboxBackend: "unknown",
    model: "test/model",
    pricingModel: "test/model",
    eveVersion: "test-eve",
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-09-04T00:00:00.000Z",
  };
}

class PerformanceAdapter implements EveAdapter {
  constructor(private readonly headScale: number) {}

  async probe(): Promise<{ eveVersion: string; evalIds: string[] }> {
    return { eveVersion: "test-eve", evalIds: ["eval/pass"] };
  }

  async runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord> {
    return performanceRecord(ref, commitSha, opts.runIndex, ref === "main" ? 1 : this.headScale);
  }
}

async function runComparisonCli(
  args: string[],
  options: {
    headScale?: number;
    onValidityPatterns?: (patterns: readonly string[]) => void;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(
    ["node", "diff0", "run", "--base", "main", "--repo", "/fake/repo", "--runs", "1", ...args],
    {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
    {
      adapter: new PerformanceAdapter(options.headScale ?? 3),
      createWorktree: async (_repoPath, ref, worktreeOptions) => ({
        path: `/fake/${ref}`,
        commitSha: worktreeOptions?.resolvedCommitSha ?? "0".repeat(40),
        cleanup: async () => {},
      }),
      inferSandbox: async () => ({ backend: "docker", inferred: true }),
      getAgentInfo: async () => ({ model: "test/model", skills: [], tools: [], subagents: [] }),
      resolveRef: async (_repoPath, ref) => (ref === "main" ? "a" : "b").repeat(40),
      readCache: async () => null,
      writeCache: async () => {},
      ...(options.onValidityPatterns !== undefined
        ? {
            getEvalHarnessChanges: async (
              _repoPath: string,
              _base: string,
              _head: string,
              _appDir: string,
              patterns: readonly string[] = [],
            ) => {
              options.onValidityPatterns?.(patterns);
              return [];
            },
          }
        : {}),
      getSandboxConfigChanges: async () => [],
    },
  );
  return { code, stdout, stderr };
}

describe("diff0 CLI granular enforcement and performance budgets", () => {
  it("documents granular policies, validity globs, and all performance budgets in run help", async () => {
    let stdout = "";
    const code = await runCli(["node", "diff0", "run", "--help"], {
      out: (text) => {
        stdout += text;
      },
      err: () => {},
    });

    expect(code).toBe(0);
    expect(stdout).toContain("comma-separated granular categories");
    expect(stdout).toContain("--validity-path <glob>");
    expect(stdout).toContain("--max-cost-increase-pct <pct>");
    expect(stdout).toContain("--max-input-token-increase-pct <pct>");
    expect(stdout).toContain("--max-output-token-increase-pct <pct>");
    expect(stdout).toContain("--max-duration-increase-pct <pct>");
  });

  it("keeps legacy regression behavior while granular performance policy can fail yellow", async () => {
    const legacy = await runComparisonCli(["--fail-on", "regression"]);
    const granular = await runComparisonCli(["--fail-on", "performance-regression"]);

    expect(legacy.code).toBe(0);
    expect(granular.code).toBe(1);
  });

  it("accepts comma-separated granular policies and fails when any selected category is violated", async () => {
    const result = await runComparisonCli(["--fail-on", "eval-regression,performance-regression"]);

    expect(result.code).toBe(1);
  });

  it.each([
    ["a mixed legacy/granular list", "regression,performance-regression", "cannot mix"],
    ["an unknown category", "performance-regression,unknown", "unknown --fail-on policy"],
    ["an empty category", "performance-regression,", "must not contain empty"],
  ])("rejects %s as usage exit 2", async (_case, policy, message) => {
    const result = await runComparisonCli(["--fail-on", policy]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it("threads custom thresholds into analysis and exposes them in JSON", async () => {
    const result = await runComparisonCli([
      "--json",
      "--fail-on",
      "never",
      "--max-cost-increase-pct",
      "50",
      "--max-input-token-increase-pct",
      "50",
      "--max-output-token-increase-pct",
      "50",
      "--max-duration-increase-pct",
      "50",
    ]);
    const report = JSON.parse(result.stdout) as {
      costPerf: { regressions: Array<{ metric: string; thresholdPct: number }> };
      meta: {
        base: { sandboxBackend: string };
        head: { sandboxBackend: string };
        hostDefaultSandboxCandidate: string;
      };
    };

    expect(result.code).toBe(0);
    expect(report.costPerf.regressions).toEqual([
      { baseMedian: 0.1, deltaPct: 200, headMedian: 0.3, metric: "costUsd", thresholdPct: 50 },
      { baseMedian: 100, deltaPct: 200, headMedian: 300, metric: "tokensIn", thresholdPct: 50 },
      { baseMedian: 100, deltaPct: 200, headMedian: 300, metric: "tokensOut", thresholdPct: 50 },
      { baseMedian: 1000, deltaPct: 200, headMedian: 3000, metric: "durationMs", thresholdPct: 50 },
    ]);
    expect(report.meta.base.sandboxBackend).toBe("unknown");
    expect(report.meta.head.sandboxBackend).toBe("unknown");
    expect(report.meta.hostDefaultSandboxCandidate).toBe("docker");
  });

  it("does not fail granular performance enforcement for improvements, even at zero", async () => {
    const result = await runComparisonCli(
      [
        "--fail-on",
        "performance-regression",
        "--max-cost-increase-pct",
        "0",
        "--max-input-token-increase-pct",
        "0",
        "--max-output-token-increase-pct",
        "0",
        "--max-duration-increase-pct",
        "0",
      ],
      { headScale: 0.5 },
    );

    expect(result.code).toBe(0);
  });

  it.each([
    ["--max-cost-increase-pct", "-1"],
    ["--max-input-token-increase-pct", "Infinity"],
    ["--max-output-token-increase-pct", "NaN"],
    ["--max-duration-increase-pct", "12oops"],
  ])("rejects invalid percentage %s=%s as usage exit 2", async (flag, value) => {
    const result = await runComparisonCli([flag, value]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("finite non-negative percentage");
  });
});

describe("diff0 CLI additive validity paths", () => {
  it("collects repeated and comma-separated patterns for the harness", async () => {
    let observed: readonly string[] = [];
    const result = await runComparisonCli(
      [
        "--fail-on",
        "never",
        "--validity-path",
        "src/scorers/**,packages/eval-utils/**",
        "--validity-path",
        "config/evals.json",
      ],
      { onValidityPatterns: (patterns) => (observed = patterns) },
    );

    expect(result.code).toBe(0);
    expect(observed).toEqual(["src/scorers/**", "packages/eval-utils/**", "config/evals.json"]);
  });

  it("rejects empty validity globs as usage exit 2", async () => {
    const result = await runComparisonCli(["--validity-path", "src/scorers/**,"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("must not contain empty globs");
  });

  it("classifies a core-rejected escaping validity glob as usage exit 2", async () => {
    const result = await runComparisonCli(["--validity-path", "../outside/**"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("validity pattern must be a contained repo-relative glob");
  });
});
