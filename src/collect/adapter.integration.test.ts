import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoRepository } from "../../test/helpers/demo-repository.js";
/**
 * fixtures/demo-agent runs end-to-end through the worktree and Eve adapter.
 *
 * Copies the fixture into a scratch git repo with two refs (base, head — the
 * head file is cosmetic and does not change behavior), creates a worktree
 * per ref with dependencies installed, probes eve, runs the suite once per
 * ref, and asserts both normalized RunRecords.
 */

import { EveCliAdapter, getAgentInfo } from "../adapters/eve.js";
import { createWorktree, type WorktreeHandle } from "../harness/worktree.js";
import type { RunRecord } from "../types.js";

const INTEGRATION_TIMEOUT_MS = 240_000;

let scratch: string;
let agentRepo: string;

const originalDemoModel = process.env.DIFF0_DEMO_MODEL;
beforeAll(async () => {
  process.env.DIFF0_DEMO_MODEL = "mock";
  ({ scratch, agentRepo } = await demoRepository("adapter"));
}, INTEGRATION_TIMEOUT_MS);

afterAll(async () => {
  if (originalDemoModel === undefined) delete process.env.DIFF0_DEMO_MODEL;
  else process.env.DIFF0_DEMO_MODEL = originalDemoModel;
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
