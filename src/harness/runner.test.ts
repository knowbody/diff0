/**
 * Runner orchestration tests with injected fakes: counterbalanced order, cache
 * hit/miss/skip semantics, worktree cleanup, and failure wrapping. Git,
 * filesystem caches, Eve, worktrees, sandbox probes, and agent-info probes
 * are fakes; their concrete implementations have dedicated tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CommandInterruptedError } from "../adapters/eve.js";
import { computeCacheKey } from "../collect/cache.js";
import type { AgentInfo, EveAdapter, RunOptions, RunRecord } from "../types.js";
import { EvalRunError, runComparison } from "./runner.js";
import type { CreateWorktreeOptions, WorktreeHandle } from "./worktree.js";

const FAKE_EVE_VERSION = "0.29.5-fake";
const FAKE_MODEL = "fake/model";

function fakeRecord(ref: string, commitSha: string, runIndex: number): RunRecord {
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
    costUsd: null,
    durationMs: 1500,
    sandboxBackend: "docker",
    model: FAKE_MODEL,
    pricingModel: FAKE_MODEL,
    eveVersion: FAKE_EVE_VERSION,
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-08-03T10:00:00.000Z",
  };
}

/** Records every suite invocation; optionally fails one specific run. */
class FakeAdapter implements EveAdapter {
  readonly calls: Array<{ ref: string; runIndex: number; opts: RunOptions }> = [];
  failAt?: { cwd: string; runIndex: number };

  async probe(_cwd: string): Promise<{ eveVersion: string; evalIds: string[] }> {
    return { eveVersion: FAKE_EVE_VERSION, evalIds: ["e/one"] };
  }

  async runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord> {
    if (this.failAt && opts.cwd === this.failAt.cwd && opts.runIndex === this.failAt.runIndex) {
      throw new Error("synthetic eval crash");
    }
    this.calls.push({ ref, runIndex: opts.runIndex, opts });
    return fakeRecord(ref, commitSha, opts.runIndex);
  }
}

class InterruptedAdapter extends FakeAdapter {
  override async runEvalSuite(): Promise<RunRecord> {
    throw new CommandInterruptedError("eve", ["eval"], "SIGINT");
  }
}

interface FakeWorktrees {
  factory: (repoPath: string, ref: string, opts?: CreateWorktreeOptions) => Promise<WorktreeHandle>;
  cleanups: string[];
  options: CreateWorktreeOptions[];
}

function fakeWorktrees(sha: string): FakeWorktrees {
  const cleanups: string[] = [];
  const options: CreateWorktreeOptions[] = [];
  return {
    cleanups,
    options,
    factory: async (_repoPath: string, ref: string, opts = {}) => {
      options.push(opts);
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
const sha = "a".repeat(40);
const cache = new Map<string, RunRecord[]>();

const fakeResolveRef = async (_repoPath: string, ref: string): Promise<string> => {
  if (ref === "does-not-exist") throw new Error(`ref '${ref}' was not found in ${repo}`);
  return sha;
};
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

function baseCacheKey(): string {
  return computeCacheKey({
    appDir: ".",
    commitSha: sha,
    eveVersion: FAKE_EVE_VERSION,
    model: FAKE_MODEL,
    evalFilter: [],
    sandboxBackend: "docker",
  });
}

describe("runComparison", () => {
  it("counterbalances base and head runs and stamps run options", async () => {
    const adapter = new FakeAdapter();
    const worktrees = fakeWorktrees(sha);
    const progress: string[] = [];

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 3,
      evalFilter: ["revenue"],
      timeoutMs: 60_000,
      maxConcurrency: 2,
      noCache: true,
      onProgress: (m) => progress.push(m),
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    // AB/BA counterbalancing: neither side always gets the first slot.
    expect(
      adapter.calls.map((c) => `${c.opts.cwd.includes("/main") ? "base" : "head"}:${c.runIndex}`),
    ).toEqual(["base:0", "head:0", "head:1", "base:1", "base:2", "head:2"]);
    for (const call of adapter.calls) {
      expect(call.opts.sandboxBackend).toBe("unknown");
      expect(call.opts.evalFilter).toEqual(["revenue"]);
      expect(call.opts.timeoutMs).toBe(60_000);
      expect(call.opts.maxConcurrency).toBe(2);
    }

    expect(result.baseRuns.map((r) => r.runIndex)).toEqual([0, 1, 2]);
    expect(result.headRuns.map((r) => r.runIndex)).toEqual([0, 1, 2]);
    expect(result.meta).toEqual({
      baseSha: sha,
      headSha: sha,
      baseEveVersion: FAKE_EVE_VERSION,
      headEveVersion: FAKE_EVE_VERSION,
      sandboxBackend: "unknown",
      sandboxInferred: false,
      hostDefaultSandboxCandidate: "docker",
      baseCacheHit: false,
      runsPerRef: 3,
      validityMismatches: [],
    });

    // Both worktrees cleaned up.
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);

    // Progress counts every run out of the counterbalanced total.
    expect(progress.some((m) => m.includes("[1/6] base run 1"))).toBe(true);
    expect(progress.some((m) => m.includes("[6/6] head run 3"))).toBe(true);
    expect(progress).toContain(
      "host default sandbox candidate: docker (actual app sandbox is not observable)",
    );
  });

  it("surfaces evaluator changes as comparison-validity mismatches before running", async () => {
    const progress: string[] = [];
    let receivedValidityPatterns: readonly string[] | undefined;
    const result = await runComparison({
      repoPath: repo,
      appDir: "apps/agent",
      baseRef: "main",
      headRef: "HEAD",
      runs: 1,
      evalFilter: [],
      noCache: true,
      onProgress: (message) => progress.push(message),
      adapter: new FakeAdapter(),
      createWorktree: fakeWorktrees(sha).factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      validityPatterns: ["packages/eval-utils/**"],
      getEvalHarnessChanges: async (_repo, _base, _head, _app, patterns) => {
        receivedValidityPatterns = patterns;
        return ["apps/agent/evals/quality.eval.ts", "packages/eval-utils/scorer.ts"];
      },
      ...fakeGitAndCache,
    });

    expect(result.meta.validityMismatches).toEqual([
      expect.stringContaining("eval harness differs between refs"),
    ]);
    expect(progress[0]).toContain("warning: eval harness differs between refs");
    expect(receivedValidityPatterns).toEqual(["packages/eval-utils/**"]);
  });

  it("flags authored sandbox configuration changes without claiming a backend", async () => {
    const result = await runComparison({
      repoPath: repo,
      appDir: "apps/agent",
      baseRef: "main",
      headRef: "HEAD",
      runs: 1,
      evalFilter: [],
      noCache: true,
      adapter: new FakeAdapter(),
      createWorktree: fakeWorktrees(sha).factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      getEvalHarnessChanges: async () => [],
      getSandboxConfigChanges: async () => ["apps/agent/agent/sandbox.ts"],
      ...fakeGitAndCache,
    });

    expect(result.meta.sandboxBackend).toBe("unknown");
    expect(result.meta.sandboxInferred).toBe(false);
    expect(result.meta.hostDefaultSandboxCandidate).toBe("docker");
    expect(result.meta.validityMismatches).toEqual([
      expect.stringContaining("sandbox configuration differs between refs"),
    ]);
  });

  it("passes scripts-on install mode to both worktrees", async () => {
    const worktrees = fakeWorktrees(sha);
    await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 1,
      evalFilter: [],
      installMode: "scripts-on",
      noCache: true,
      adapter: new FakeAdapter(),
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });
    expect(worktrees.options).toEqual([
      { installDirs: [], installMode: "scripts-on", resolvedCommitSha: sha },
      { installDirs: [], installMode: "scripts-on", resolvedCommitSha: sha },
    ]);
  });

  it("rejects a worktree whose checked-out commit differs from the resolved ref", async () => {
    const worktrees = fakeWorktrees("b".repeat(40));
    await expect(
      runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "main",
        headRef: "HEAD",
        runs: 1,
        evalFilter: [],
        adapter: new FakeAdapter(),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      }),
    ).rejects.toThrow(/base worktree commit mismatch/);
    expect(worktrees.cleanups).toEqual(["main"]);
  });

  it("uses cached base runs (>= runs) and executes head only", async () => {
    const key = baseCacheKey();
    const cachedSha = sha;
    await fakeWriteCache(repo, key, [
      fakeRecord("main", cachedSha, 0),
      fakeRecord("main", cachedSha, 1),
      fakeRecord("main", cachedSha, 2),
    ]);

    const adapter = new FakeAdapter();
    const worktrees = fakeWorktrees(cachedSha);
    const progress: string[] = [];

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      onProgress: (m) => progress.push(m),
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(result.meta.baseCacheHit).toBe(true);
    // Only the first `runs` cached records are used.
    expect(result.baseRuns.map((r) => r.runIndex)).toEqual([0, 1]);
    // Adapter saw head runs only.
    expect(
      adapter.calls.map((c) => `${c.opts.cwd.includes("/main") ? "base" : "head"}:${c.runIndex}`),
    ).toEqual(["head:0", "head:1"]);
    expect(progress.some((m) => m.includes("base cache hit"))).toBe(true);
    expect(progress.some((m) => m.includes("[2/2] head run 2"))).toBe(true);
  });

  it("misses the cache when fewer records are cached than runs requested", async () => {
    const key = baseCacheKey();
    const cachedSha = sha;
    await fakeWriteCache(repo, key, [fakeRecord("main", cachedSha, 0)]);

    const adapter = new FakeAdapter();
    const worktrees = fakeWorktrees(cachedSha);

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(result.meta.baseCacheHit).toBe(false);
    expect(adapter.calls).toHaveLength(4);
    // The fresh base runs overwrote the short cache entry.
    const rewritten = await fakeReadCache(repo, key);
    expect(rewritten).toHaveLength(2);
  });

  it("writes the base cache after a fresh run", async () => {
    const cachedSha = sha;
    const adapter = new FakeAdapter();
    const worktrees = fakeWorktrees(cachedSha);

    const result = await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    const key = baseCacheKey();
    const cached = await fakeReadCache(repo, key);
    expect(cached).toEqual(result.baseRuns);
  });

  it("skips cache read AND write under noCache", async () => {
    const key = baseCacheKey();
    const cachedSha = sha;
    await fakeWriteCache(repo, key, [
      fakeRecord("main", cachedSha, 0),
      fakeRecord("main", cachedSha, 1),
    ]);
    const before = JSON.stringify(await fakeReadCache(repo, key));

    const adapter = new FakeAdapter();
    const worktrees = fakeWorktrees(cachedSha);
    await runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      noCache: true,
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    // Base runs executed despite the seeded cache; the file is untouched.
    expect(adapter.calls).toHaveLength(4);
    expect(JSON.stringify(await fakeReadCache(repo, key))).toBe(before);
  });

  it("wraps a crashed run in EvalRunError with ref + runIndex and still cleans up", async () => {
    const adapter = new FakeAdapter();
    adapter.failAt = { cwd: "/fake-worktree/HEAD", runIndex: 1 };
    const worktrees = fakeWorktrees(sha);

    const promise = runComparison({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 2,
      evalFilter: [],
      noCache: true,
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    let caught: unknown;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EvalRunError);
    const error = caught as EvalRunError;
    expect(error.side).toBe("head");
    expect(error.runIndex).toBe(1);
    expect(error.ref).toBe("HEAD");
    expect(error.message).toContain("synthetic eval crash");
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
    // No cache entry was written for the aborted comparison.
    expect(cache.size).toBe(0);
  });

  it("preserves cancellation while still cleaning up both worktrees", async () => {
    const worktrees = fakeWorktrees(sha);
    await expect(
      runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "main",
        headRef: "HEAD",
        runs: 1,
        evalFilter: [],
        noCache: true,
        adapter: new InterruptedAdapter(),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      }),
    ).rejects.toBeInstanceOf(CommandInterruptedError);
    expect(worktrees.cleanups.sort()).toEqual(["HEAD", "main"]);
  });

  it("rejects a non-positive runs count", async () => {
    await expect(
      runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "main",
        headRef: "HEAD",
        runs: 0,
        evalFilter: [],
      }),
    ).rejects.toThrow(/runs must be a positive integer/);
  });

  it("propagates unknown-ref errors before creating any worktree", async () => {
    const worktrees = fakeWorktrees(sha);
    await expect(
      runComparison({
        repoPath: repo,
        appDir: ".",
        baseRef: "does-not-exist",
        headRef: "HEAD",
        runs: 1,
        evalFilter: [],
        adapter: new FakeAdapter(),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      }),
    ).rejects.toThrow(/was not found in/);
    expect(worktrees.cleanups).toEqual([]);
  });
});
