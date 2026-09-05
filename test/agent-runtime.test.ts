import { describe, expect, it, vi } from "vitest";
import { runReviewChecks } from "../agent/lib/github/review-checks.js";
import {
  enforceStationRetries,
  recordStationResult,
  type StationRetries,
} from "../agent/lib/station-retries.js";

const initial = (): StationRetries => ({ turnId: "", seen: [], failures: {} });

describe("station retry limit", () => {
  it("stops after the second failure, before a third attempt", () => {
    let state = initial();
    const dispatch = vi.fn();
    expect(() => {
      for (let attempt = 0; attempt < 3; attempt++) {
        dispatch();
        state = recordStationResult(state, "turn", `call-${attempt}`, "analyst", true);
        enforceStationRetries(state);
      }
    }).toThrow("one retry is exhausted");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates replayed results and maintains independent station counters", () => {
    let state = recordStationResult(initial(), "turn", "call-1", "analyst", true);
    state = recordStationResult(state, "turn", "call-1", "analyst", true);
    state = recordStationResult(state, "turn", "call-2", "reviewer", true);
    expect(() => enforceStationRetries(state)).not.toThrow();
    expect(state.failures).toEqual({ analyst: 1, reviewer: 1 });
  });

  it("allows successful review revisions and resets after success or a new turn", () => {
    let state = recordStationResult(initial(), "turn", "1", "reviewer", true);
    state = recordStationResult(state, "turn", "2", "reviewer", false);
    state = recordStationResult(state, "turn", "3", "reviewer", true);
    expect(() => enforceStationRetries(state)).not.toThrow();
    state = recordStationResult(state, "next-turn", "4", "reviewer", true);
    expect(state.failures.reviewer).toBe(1);
  });
});

function sandbox(fail?: string, changed = "src/report/format.ts") {
  const run = vi.fn(async ({ command }: { command: string }) => ({
    exitCode: fail && command.includes(fail) ? 1 : 0,
    stdout: command.includes("diff --name-only") ? changed : "passed",
    stderr: fail && command.includes(fail) ? "prerequisite unavailable" : "",
  }));
  return {
    run,
    readTextFile: vi.fn(async () => JSON.stringify({ sha: "a".repeat(40) })),
  };
}

describe("required review checks", () => {
  it("blocks missing integration prerequisites before attestation or comparison", async () => {
    const vm = sandbox("pnpm test:integration");
    await expect(runReviewChecks(vm as never)).rejects.toThrow("prerequisite unavailable");
    expect(vm.run.mock.calls.some(([input]) => input.command.includes("DIFF0_DEMO_MODEL"))).toBe(
      false,
    );
  });

  it("requires the bundle and a mock comparison for engine changes", async () => {
    const vm = sandbox();
    const passed = await runReviewChecks(vm as never);
    expect(passed).toHaveLength(7);
    expect(passed.at(-1)).toContain("DIFF0_DEMO_MODEL=mock");
    expect(passed.at(-1)).toContain("--fail-on drift");
    expect(passed.at(-2)).toContain("git diff --exit-code -- action/dist/cli.mjs");
  });

  it("does not waive a failed comparison", async () => {
    await expect(runReviewChecks(sandbox("DIFF0_DEMO_MODEL") as never)).rejects.toThrow(
      "Required review check failed",
    );
  });

  it("rejects an invalid base before executing commands", async () => {
    const vm = sandbox();
    vm.readTextFile.mockResolvedValue(JSON.stringify({ sha: "$(command)" }));
    await expect(runReviewChecks(vm as never)).rejects.toThrow("valid checkout base SHA");
    expect(vm.run).not.toHaveBeenCalled();
  });
});
