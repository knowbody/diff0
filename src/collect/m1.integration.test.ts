/**
 * fixtures/demo-agent runs end-to-end through the worktree and Eve adapter.
 *
 * Copies the fixture into a scratch git repo with two refs (base, head — the
 * head tweak is cosmetic and does not change behavior), creates a worktree
 * per ref with dependencies installed, probes eve, runs the suite once per
 * ref, and asserts both normalized RunRecords.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EveCliAdapter, getAgentInfo } from "../adapters/eve.js";
import { createWorktree, type WorktreeHandle } from "../harness/worktree.js";
import type { RunRecord } from "../types.js";

const INTEGRATION_TIMEOUT_MS = 240_000;

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const fixtureDir = join(repoRoot, "fixtures", "demo-agent");

function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=diff0-test", "-c", "user.email=test@diff0.invalid", ...args],
    // stderr piped (not inherited): on case-insensitive filesystems git warns
    // that refname "head" is ambiguous with HEAD; harmless here.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

let scratch: string;
let agentRepo: string;

beforeAll(async () => {
  // Pin the fixture to its deterministic mock model even on machines where
  // gateway credentials (AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN) are exported:
  // the demo agent auto-selects a real model when it sees a key (see
  // fixtures/demo-agent/agent/lib/demo-model.ts), and this suite must stay
  // hermetic — zero credentials, zero spend. The adapter passes parent env
  // through to the eve subprocess, so this reaches the fixture's agent.ts.
  process.env.DIFF0_DEMO_MODEL = "mock";
  scratch = await mkdtemp(join(tmpdir(), "diff0-m1-"));
  agentRepo = join(scratch, "demo-agent");
  await cp(fixtureDir, agentRepo, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== "node_modules" && name !== ".eve";
    },
  });
  // Pin the instructions this test asserts against, regardless of what the
  // committed fixture currently says — dogfood PRs edit the fixture's
  // instructions on purpose (that IS the drift demo), and this test must not
  // inherit that drift.
  writeFileSync(
    join(agentRepo, "agent", "instructions.md"),
    [
      "# Identity",
      "",
      "You are a meticulous revenue analyst for Demo Corp.",
      "",
      "# Rules",
      "",
      "- You MUST load the `revenue-definitions` skill before answering any revenue",
      "  question, so your figures use the canonical definitions.",
      "- Use the `run_sql` tool to compute figures; never estimate from memory.",
      "- After computing a figure, delegate a one-line executive summary to the",
      "  `reporter` subagent before replying.",
      "- Report totals using the canonical `TOTAL_REVENUE=<n>` format.",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["init", "-q", "-b", "main", agentRepo], { encoding: "utf8" });
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "base"]);
  gitIn(agentRepo, ["branch", "base"]);
  gitIn(agentRepo, ["checkout", "-q", "-b", "head"]);
  // Cosmetic instructions tweak: does NOT change agent behavior.
  appendFileSync(
    join(agentRepo, "agent", "instructions.md"),
    "\n<!-- cosmetic touch-up for the head ref; behavior unchanged -->\n",
  );
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "head: cosmetic instructions tweak"]);
}, INTEGRATION_TIMEOUT_MS);

afterAll(async () => {
  delete process.env.DIFF0_DEMO_MODEL;
  if (scratch !== undefined) {
    await rm(scratch, { recursive: true, force: true });
  }
});

function assertDemoAgentRunRecord(record: RunRecord, ref: string, commitSha: string): void {
  expect(record.ref).toBe(ref);
  expect(record.commitSha).toBe(commitSha);
  expect(record.runIndex).toBe(0);

  // All 3 evals pass on both refs.
  expect(record.evalResults).toHaveLength(3);
  for (const evalResult of record.evalResults) {
    expect(evalResult.passed).toBe(true);
    expect(evalResult.checks.length).toBeGreaterThan(0);
  }
  expect(record.evalResults.map((e) => e.name).sort()).toEqual([
    "revenue/no-failed-actions",
    "revenue/total-revenue",
    "revenue/uses-sql-tool",
  ]);

  // Behavior signals.
  expect(record.toolCalls.some((call) => call.name === "run_sql")).toBe(true);
  expect(record.skillsLoaded).toContain("revenue-definitions");
  expect(record.subagentCalls.some((call) => call.name === "reporter")).toBe(true);
  for (const call of record.toolCalls) {
    expect(call.inputsHash).toMatch(/^[0-9a-f]{64}$/);
  }

  // Tokens exist and are numbers (the mock model reports estimated counts).
  expect(Number.isFinite(record.tokens.input)).toBe(true);
  expect(Number.isFinite(record.tokens.output)).toBe(true);
  // No AI Gateway in the loop -> no cost source.
  expect(record.costUsd).toBeNull();

  expect(record.model).toBe("eve-mock/mock-revenue-analyst");
  expect(record.eveVersion).toBe("0.47.5");
  expect(record.durationMs).toBeGreaterThan(0);
  expect(Date.parse(record.startedAt)).not.toBeNaN();
  expect(record.dataSources).toEqual({ evalJson: true, spans: false, logs: false });
}

describe("demo-agent through worktree and Eve adapter", () => {
  it("runs the suite once per ref and yields complete RunRecords", {
    timeout: INTEGRATION_TIMEOUT_MS,
  }, async () => {
    const adapter = new EveCliAdapter();
    const worktrees: WorktreeHandle[] = [];
    try {
      const base = await createWorktree(agentRepo, "base");
      worktrees.push(base);
      const head = await createWorktree(agentRepo, "head");
      worktrees.push(head);

      expect(base.commitSha).not.toBe(head.commitSha);

      const records: RunRecord[] = [];
      for (const [ref, worktree] of [
        ["base", base],
        ["head", head],
      ] as const) {
        const probed = await adapter.probe(worktree.path);
        expect(probed.eveVersion).toBe("0.47.5");
        expect(probed.evalIds).toHaveLength(3);
        expect(probed.evalIds).toContain("revenue/total-revenue");

        records.push(
          await adapter.runEvalSuite(ref, worktree.commitSha, {
            cwd: worktree.path,
            runIndex: 0,
            evalFilter: [],
          }),
        );
      }

      const [baseRecord, headRecord] = records;
      if (baseRecord === undefined || headRecord === undefined) {
        throw new Error("expected two run records");
      }
      assertDemoAgentRunRecord(baseRecord, "base", base.commitSha);
      assertDemoAgentRunRecord(headRecord, "head", head.commitSha);

      // Same behavior on both refs: the cosmetic tweak changes nothing.
      expect(headRecord.toolCalls.map((c) => c.name)).toEqual(
        baseRecord.toolCalls.map((c) => c.name),
      );
      expect(headRecord.skillsLoaded).toEqual(baseRecord.skillsLoaded);

      // Surface capture (banner-on-stdout tolerant).
      const info = await getAgentInfo(base.path);
      expect(info).not.toBeNull();
      expect(info?.model).toBe("eve-mock/mock-revenue-analyst");
      expect(info?.skills).toContain("revenue-definitions");
      expect(info?.tools).toContain("run_sql");
      expect(info?.subagents).toContain("reporter");
    } finally {
      for (const worktree of worktrees) {
        await worktree.cleanup();
      }
    }
  });
});
