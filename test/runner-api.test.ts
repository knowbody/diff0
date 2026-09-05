import { beforeEach, expect, it, vi } from "vitest";
import { runComparison } from "../src/harness/runner.js";
import { compareRefs } from "../src/runner.js";
import { buildRuns } from "./helpers/records.js";

vi.mock("../src/harness/runner.js", async (original) => ({
  ...(await original<typeof import("../src/harness/runner.js")>()),
  runComparison: vi.fn(),
}));
vi.mock("../src/harness/gitdiff.js", async (original) => ({
  ...(await original<typeof import("../src/harness/gitdiff.js")>()),
  getDiffStat: vi.fn().mockResolvedValue(null),
}));

const options = {
  repoPath: ".",
  appDir: ".",
  baseRef: "main",
  headRef: "HEAD",
  runs: 3,
  evalFilter: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runComparison).mockResolvedValue({
    baseRuns: buildRuns(
      "main",
      "aaa1111",
      Array.from({ length: 3 }, () => ({ evals: { smoke: true }, durationMs: 100 })),
    ),
    headRuns: buildRuns(
      "topic",
      "bbb2222",
      Array.from({ length: 3 }, () => ({ evals: { smoke: true }, durationMs: 180 })),
    ),
    meta: {
      baseSha: "aaa1111",
      headSha: "bbb2222",
      baseEveVersion: "0.29.5",
      headEveVersion: "0.29.5",
      sandboxBackend: "unknown",
      sandboxInferred: false,
      hostDefaultSandboxCandidate: "docker",
      baseCacheHit: false,
      runsPerRef: 3,
      validityMismatches: ["Evaluator changed"],
    },
  });
});

it("preserves collection validity and applies caller performance policy without implicit cache reuse", async () => {
  const report = await compareRefs({ ...options, performanceThresholds: { durationMs: 50 } });
  expect(runComparison).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));
  expect(report.meta.mismatches).toContain("Evaluator changed");
  expect(report.meta.base.sandboxInferred).toBe(false);
  expect(report.costPerf.regressions).toEqual(
    expect.arrayContaining([expect.objectContaining({ metric: "durationMs" })]),
  );
});

it("honors explicit cache reuse and propagates execution errors to its caller", async () => {
  const failure = new Error("collection failed");
  vi.mocked(runComparison).mockRejectedValue(failure);
  await expect(compareRefs({ ...options, noCache: false })).rejects.toBe(failure);
  expect(runComparison).toHaveBeenCalledWith(expect.objectContaining({ noCache: false }));
});
