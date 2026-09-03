/**
 * --max-spend enforcement tests: the cap triggers at the right run boundary
 * (post-run, never mid-run), worktrees are still cleaned up, cached base runs
 * never count toward the cap, unmeasurable cost never triggers it, and exit
 * code 4 surfaces through runCli with the "how far it got" message.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EvalFilterNoMatchError } from "../adapters/eve.js";
import { runCli } from "../cli.js";
import { computeCacheKey } from "../collect/cache.js";
import type { AgentInfo, EveAdapter, RunOptions, RunRecord } from "../types.js";
import { MaxSpendExceededError, runComparison, type SpendUpdate } from "./runner.js";
import type { WorktreeHandle } from "./worktree.js";

const FAKE_EVE_VERSION = "0.29.5-fake";
const FAKE_MODEL = "fake/unpriced-model";

function costedRecord(
  ref: string,
  commitSha: string,
  runIndex: number,
  costUsd: number | null,
): RunRecord {
  return {
    ref,
    commitSha,
    runIndex,
    evalResults: [{ name: "e/one", passed: true, checks: [{ name: "c", passed: true }] }],
    toolCalls: [],
    skillLoads: [],
    skillsLoaded: [],
    subagentCalls: [],
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    costUsd,
    durationMs: 1500,
    sandboxBackend: "docker",
    model: FAKE_MODEL,
    pricingModel: FAKE_MODEL,
    eveVersion: FAKE_EVE_VERSION,
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-08-03T10:00:00.000Z",
  };
}

/** Every suite run reports the same (gateway) cost; null = unmeasurable. */
class CostedAdapter implements EveAdapter {
  readonly calls: Array<{ cwd: string; runIndex: number }> = [];
  constructor(private readonly costPerRun: number | null) {}

  async probe(_cwd: string): Promise<{ eveVersion: string; evalIds: string[] }> {
    return { eveVersion: FAKE_EVE_VERSION, evalIds: ["e/one"] };
  }

  async runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord> {
    this.calls.push({ cwd: opts.cwd, runIndex: opts.runIndex });
    return costedRecord(ref, commitSha, opts.runIndex, this.costPerRun);
  }
}

class FilterMissAdapter extends CostedAdapter {
  override async runEvalSuite(
    _ref: string,
    _commitSha: string,
    _opts: RunOptions,
  ): Promise<RunRecord> {
    throw new EvalFilterNoMatchError(["missing"], ["e/one"]);
  }
}

interface FakeWorktrees {
  factory: (repoPath: string, ref: string) => Promise<WorktreeHandle>;
  created: string[];
  cleanups: string[];
}

function fakeWorktrees(sha: string): FakeWorktrees {
  const created: string[] = [];
  const cleanups: string[] = [];
  return {
    created,
    cleanups,
    factory: async (_repoPath: string, ref: string) => {
      created.push(ref);
      return {
        path: `/fake-worktree/${ref}`,
        commitSha: sha,
        cleanup: async () => {
          cleanups.push(ref);
        },
      };
    },
  };
}

const fakeSandbox = async () => ({ backend: "docker" as const, inferred: true as const });
const fakeAgentInfo = async (_cwd: string): Promise<AgentInfo | null> => ({
  model: FAKE_MODEL,
  skills: [],
  tools: [],
  subagents: [],
});

const repo = "/fake/repo";
const sha = "c".repeat(40);
const cache = new Map<string, RunRecord[]>();

const fakeResolveRef = async (): Promise<string> => sha;
const fakeReadCache = async (_repoPath: string, key: string): Promise<RunRecord[] | null> =>
  cache.get(key) ?? null;
const fakeWriteCache = async (
  _repoPath: string,
  key: string,
  records: RunRecord[],
): Promise<void> => {
  cache.set(key, structuredClone(records));
};
const fakeGitAndCache = {
  resolveRef: fakeResolveRef,
  readCache: fakeReadCache,
  writeCache: fakeWriteCache,
};

beforeEach(() => {
  cache.clear();
});

describe("runComparison --max-spend", () => {
  it("aborts at the exact run boundary where measured spend crosses the cap", async () => {
    // $0.05/run, cap $0.22: run 5 pushes cumulative spend to $0.25 > cap.
    const adapter = new CostedAdapter(0.05);
    const worktrees = fakeWorktrees(sha);
    const spendUpdates: SpendUpdate[] = [];

    let caught: unknown;
    try {
      await runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "main",
        headRef: "HEAD",
        runs: 3,
        evalFilter: [],
        noCache: true,
        maxSpendUsd: 0.22,
        onSpend: (update) => spendUpdates.push(update),
        adapter,
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MaxSpendExceededError);
    const error = caught as MaxSpendExceededError;
    expect(error.spentUsd).toBeCloseTo(0.25, 10);
    expect(error.capUsd).toBe(0.22);
    expect(error.completedRuns).toBe(5);
    expect(error.totalRuns).toBe(6);
    expect(error.message).toContain("$0.2500");
    expect(error.message).toContain("5 of 6 suite runs");
    expect(error.message).toContain("partial results discarded");

    // Exactly 5 suite runs executed — the 6th was never started.
    expect(adapter.calls).toHaveLength(5);
    // Both worktrees still cleaned up despite the abort.
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
    // No cache written for the aborted comparison (noCache anyway, belt+braces).
    expect(cache.size).toBe(0);
    // onSpend saw the cumulative climb.
    expect(spendUpdates.map((u) => u.spentUsd?.toFixed(2))).toEqual([
      "0.05",
      "0.10",
      "0.15",
      "0.20",
      "0.25",
    ]);
  });

  it("never triggers on unmeasurable cost (null costUsd, unpriced model)", async () => {
    const adapter = new CostedAdapter(null);
    const worktrees = fakeWorktrees(sha);
    const spendUpdates: SpendUpdate[] = [];

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      noCache: true,
      maxSpendUsd: 0.000001, // absurdly low cap — still must not trigger
      onSpend: (update) => spendUpdates.push(update),
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(result.baseRuns).toHaveLength(2);
    expect(result.headRuns).toHaveLength(2);
    // Spend is reported as null (unknown), never $0.
    expect(spendUpdates).toHaveLength(4);
    expect(spendUpdates.every((u) => u.spentUsd === null)).toBe(true);
  });

  it("excludes cached base runs from the cap (only this invocation's spend counts)", async () => {
    const cachedSha = sha;
    const key = computeCacheKey({
      appDir: ".",
      commitSha: cachedSha,
      eveVersion: FAKE_EVE_VERSION,
      model: FAKE_MODEL,
      evalFilter: [],
      sandboxBackend: "docker",
    });
    // Cached base runs are absurdly expensive — they must NOT count.
    await fakeWriteCache(repo, key, [
      costedRecord("main", cachedSha, 0, 100),
      costedRecord("main", cachedSha, 1, 100),
      costedRecord("main", cachedSha, 2, 100),
    ]);

    const adapter = new CostedAdapter(0.05);
    const worktrees = fakeWorktrees(cachedSha);

    let caught: unknown;
    try {
      await runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "main",
        headRef: "HEAD",
        runs: 3,
        evalFilter: [],
        maxSpendUsd: 0.12,
        adapter,
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      });
    } catch (error) {
      caught = error;
    }

    // Head-only spend: $0.05, $0.10, $0.15 → crosses the $0.12 cap at head run 3.
    expect(caught).toBeInstanceOf(MaxSpendExceededError);
    const error = caught as MaxSpendExceededError;
    expect(error.spentUsd).toBeCloseTo(0.15, 10);
    expect(error.completedRuns).toBe(3);
    expect(error.totalRuns).toBe(3);
    expect(adapter.calls).toHaveLength(3);
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
  });

  it("completes normally when total spend stays at or under the cap", async () => {
    const adapter = new CostedAdapter(0.05);
    const worktrees = fakeWorktrees(sha);

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      noCache: true,
      maxSpendUsd: 0.2, // exactly 4 x $0.05 — "would exceed" means strictly over
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(result.baseRuns).toHaveLength(2);
    expect(result.headRuns).toHaveLength(2);
    expect(adapter.calls).toHaveLength(4);
  });
});

describe("diff0 run --max-spend via runCli", () => {
  async function cli(
    args: string[],
    seams: Parameters<typeof runCli>[2],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const code = await runCli(
      ["node", "diff0", ...args],
      {
        out: (text) => {
          stdout += text;
        },
        err: (text) => {
          stderr += text;
        },
      },
      seams,
    );
    return { code, stdout, stderr };
  }

  it("maps MaxSpendExceededError to exit 4 with the how-far-it-got message", async () => {
    const adapter = new CostedAdapter(0.05);
    const worktrees = fakeWorktrees(sha);

    const result = await cli(
      ["run", "--base", "main", "--repo", repo, "--runs", "3", "--max-spend", "0.22"],
      {
        adapter,
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      },
    );

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("--max-spend exceeded");
    expect(result.stderr).toContain("5 of 6 suite runs");
    expect(result.stderr).toContain("partial results discarded");
    // Aborted before any report could render.
    expect(result.stdout).not.toContain("EVALS");
    // Cleanup still happened.
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
  });

  it("rejects a non-positive --max-spend as a usage error (exit 2)", async () => {
    const result = await cli(["run", "--base", "main", "--repo", repo, "--max-spend", "0"], {});
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("positive USD amount");
  });

  it("rejects a numeric prefix followed by garbage instead of silently truncating it", async () => {
    const result = await cli(
      ["run", "--base", "main", "--repo", repo, "--max-spend", "0.25oops"],
      {},
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("must be a positive USD amount");
  });

  it("rejects an empty --evals filter instead of silently running every eval", async () => {
    const result = await cli(["run", "--base", "main", "--repo", repo, "--evals", " , "], {});
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("at least one non-empty filter");
  });

  it("maps a non-empty --evals filter that matches nothing to usage exit 2", async () => {
    const worktrees = fakeWorktrees(sha);
    const result = await cli(["run", "--base", "main", "--repo", repo, "--evals", "missing"], {
      adapter: new FilterMissAdapter(null),
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No evals matched --evals");
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
  });
});
