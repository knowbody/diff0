/**
 * `diff0 estimate` tests with injected fakes: single head worktree +
 * single measurement pass on cache miss, cached base runs as the sample on
 * hit, honest cost-unavailable projection, and the CLI-level --max-spend
 * gate (projection over cap → exit 4; unmeasurable cost → exit 0 + caveat).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CommandInterruptedError } from "../adapters/eve.js";
import { runCli } from "../cli.js";
import { computeCacheKey } from "../collect/cache.js";
import type { AgentInfo, EveAdapter, RunOptions, RunRecord } from "../types.js";
import { runEstimate } from "./estimate.js";
import type { CreateWorktreeOptions, WorktreeHandle } from "./worktree.js";

const FAKE_EVE_VERSION = "0.29.5-fake";
const FAKE_MODEL = "fake/unpriced-model";

function record(
  ref: string,
  commitSha: string,
  runIndex: number,
  costUsd: number | null,
  durationMs = 30_000,
): RunRecord {
  return {
    ref,
    commitSha,
    runIndex,
    evalResults: [
      { name: "e/one", passed: true, checks: [{ name: "c", passed: true }] },
      { name: "e/two", passed: true, checks: [{ name: "c", passed: true }] },
    ],
    toolCalls: [],
    skillLoads: [],
    skillsLoaded: [],
    subagentCalls: [],
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    costUsd,
    durationMs,
    sandboxBackend: "docker",
    model: FAKE_MODEL,
    pricingModel: FAKE_MODEL,
    eveVersion: FAKE_EVE_VERSION,
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-08-03T10:00:00.000Z",
  };
}

class FakeAdapter implements EveAdapter {
  readonly suiteCalls: Array<{ ref: string; cwd: string; runIndex: number }> = [];
  readonly runOptions: RunOptions[] = [];
  constructor(private readonly costPerRun: number | null) {}

  async probe(_cwd: string): Promise<{ eveVersion: string; evalIds: string[] }> {
    return { eveVersion: FAKE_EVE_VERSION, evalIds: ["e/one", "e/two"] };
  }

  async runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord> {
    this.suiteCalls.push({ ref, cwd: opts.cwd, runIndex: opts.runIndex });
    this.runOptions.push(structuredClone(opts));
    return record(ref, commitSha, opts.runIndex, this.costPerRun);
  }
}

class InterruptedAdapter extends FakeAdapter {
  override async runEvalSuite(): Promise<RunRecord> {
    throw new CommandInterruptedError("eve", ["eval"], "SIGTERM");
  }
}

interface FakeWorktrees {
  factory: (repoPath: string, ref: string, opts?: CreateWorktreeOptions) => Promise<WorktreeHandle>;
  created: string[];
  cleanups: string[];
  options: CreateWorktreeOptions[];
}

function fakeWorktrees(sha: string): FakeWorktrees {
  const created: string[] = [];
  const cleanups: string[] = [];
  const options: CreateWorktreeOptions[] = [];
  return {
    created,
    cleanups,
    options,
    factory: async (_repoPath: string, ref: string, opts = {}) => {
      created.push(ref);
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
const sha = "b".repeat(40);
const cache = new Map<string, RunRecord[]>();

const fakeResolveRef = async (_repoPath: string, ref: string): Promise<string> => {
  if (ref === "no-such-ref" || ref === "nope") {
    throw new Error(`Ref "${ref}" was not found in ${repo}`);
  }
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

describe("runEstimate", () => {
  it("cache miss: creates ONE head worktree, runs the suite ONCE, projects x runs x 2 refs", async () => {
    const adapter = new FakeAdapter(0.05);
    const worktrees = fakeWorktrees(sha);

    const estimate = await runEstimate({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 3,
      evalFilter: [],
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    // Exactly one worktree (head), exactly one measurement run, cleaned up.
    expect(worktrees.created).toEqual(["HEAD"]);
    expect(adapter.suiteCalls).toEqual([{ ref: "HEAD", cwd: "/fake-worktree/HEAD", runIndex: 0 }]);
    expect(worktrees.cleanups).toEqual(["HEAD"]);
    expect(worktrees.options).toEqual([
      { installDirs: [], installMode: "scripts-off", resolvedCommitSha: sha },
    ]);

    expect(estimate.sampleSource).toBe("head-run");
    expect(estimate.sampleRuns).toBe(1);
    expect(estimate.evalsPerRun).toBe(2);
    expect(estimate.perRunCostUsd).toBeCloseTo(0.05, 10);
    expect(estimate.costSource).toBe("gateway");
    expect(estimate.perRunDurationMs).toBe(30_000);
    expect(estimate.cachedBaseRuns).toBe(0);
    expect(estimate.totalRuns).toBe(6);
    expect(estimate.chargeableRuns).toBe(6);
    expect(estimate.projectedCostUsd).toBeCloseTo(0.3, 10);
    expect(estimate.projectedDurationMs).toBe(180_000);
  });

  it("fresh base cache: uses cached records as the sample, zero eval runs, head-only projection", async () => {
    const cachedSha = sha;
    const key = computeCacheKey({
      appDir: ".",
      commitSha: cachedSha,
      eveVersion: FAKE_EVE_VERSION,
      model: FAKE_MODEL,
      evalFilter: [],
      sandboxBackend: "docker",
    });
    await fakeWriteCache(repo, key, [
      record("main", cachedSha, 0, 0.02, 20_000),
      record("main", cachedSha, 1, 0.03, 30_000),
      record("main", cachedSha, 2, 0.04, 40_000),
    ]);

    const adapter = new FakeAdapter(999); // must never be asked to run
    const worktrees = fakeWorktrees(cachedSha);

    const estimate = await runEstimate({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 3,
      evalFilter: [],
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(adapter.suiteCalls).toEqual([]);
    expect(estimate.sampleSource).toBe("base-cache");
    expect(estimate.sampleRuns).toBe(3);
    // Median of $0.02/$0.03/$0.04 and 20s/30s/40s.
    expect(estimate.perRunCostUsd).toBeCloseTo(0.03, 10);
    expect(estimate.perRunDurationMs).toBe(30_000);
    expect(estimate.cachedBaseRuns).toBe(3);
    expect(estimate.chargeableRuns).toBe(3);
    expect(estimate.projectedCostUsd).toBeCloseTo(0.09, 10);
    expect(estimate.projectedDurationMs).toBe(90_000);
    expect(worktrees.cleanups).toEqual(["HEAD"]);
  });

  it("includes timeout and concurrency in the cache key and forwards them to eve on a miss", async () => {
    const adapter = new FakeAdapter(0.05);
    const worktrees = fakeWorktrees(sha);
    let observedCacheKey = "";

    await runEstimate({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 3,
      evalFilter: ["e/one"],
      timeoutMs: 45_000,
      maxConcurrency: 2,
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      resolveRef: fakeResolveRef,
      readCache: async (_repoPath, key) => {
        observedCacheKey = key;
        return null;
      },
    });

    expect(observedCacheKey).toBe(
      computeCacheKey({
        appDir: ".",
        commitSha: sha,
        eveVersion: FAKE_EVE_VERSION,
        model: FAKE_MODEL,
        evalFilter: ["e/one"],
        timeoutMs: 45_000,
        maxConcurrency: 2,
        sandboxBackend: "docker",
      }),
    );
    expect(adapter.runOptions).toEqual([
      {
        cwd: "/fake-worktree/HEAD",
        runIndex: 0,
        evalFilter: ["e/one"],
        timeoutMs: 45_000,
        maxConcurrency: 2,
        sandboxBackend: "unknown",
      },
    ]);
  });

  it("keeps cost honest when unmeasurable: null projection, source unavailable", async () => {
    const adapter = new FakeAdapter(null); // no gateway cost, unpriced model
    const worktrees = fakeWorktrees(sha);

    const estimate = await runEstimate({
      repoPath: repo,
      appDir: ".",
      baseRef: "main",
      headRef: "HEAD",
      runs: 3,
      evalFilter: [],
      adapter,
      createWorktree: worktrees.factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    });

    expect(estimate.perRunCostUsd).toBeNull();
    expect(estimate.projectedCostUsd).toBeNull();
    expect(estimate.costSource).toBe("unavailable");
    // Duration is still measured and projected — only cost is unknown.
    expect(estimate.projectedDurationMs).toBe(180_000);
  });

  it("propagates unknown-ref errors before creating any worktree", async () => {
    const worktrees = fakeWorktrees(sha);
    await expect(
      runEstimate({
        repoPath: repo,
        appDir: ".",
        baseRef: "no-such-ref",
        headRef: "HEAD",
        runs: 3,
        evalFilter: [],
        adapter: new FakeAdapter(0.05),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      }),
    ).rejects.toThrow(/was not found in/);
    expect(worktrees.created).toEqual([]);
  });
});

describe("diff0 estimate via runCli", () => {
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

  function seamsWith(adapter: EveAdapter) {
    return {
      adapter,
      createWorktree: fakeWorktrees(sha).factory,
      inferSandbox: fakeSandbox,
      getAgentInfo: fakeAgentInfo,
      ...fakeGitAndCache,
    };
  }

  it("prints the honest estimate block and exits 0 without --max-spend", async () => {
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--runs", "3"],
      seamsWith(new FakeAdapter(0.05)),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("diff0 estimate: main...HEAD (3 runs per ref planned)");
    expect(result.stdout).toContain("sample:          1 fresh suite run on head");
    expect(result.stdout).toContain("evals per run:   2");
    expect(result.stdout).toContain("cost per run:    $0.0500 (gateway)");
    expect(result.stdout).toContain("time per run:    30.0s");
    expect(result.stdout).toContain("projected runs:  6 (3 per ref x 2 refs)");
    expect(result.stdout).toContain("projected cost:  $0.3000");
    expect(result.stdout).toContain("projected time:  ~3m 00s");
    expect(result.stdout).toContain(
      "Measured on head only — base and head may genuinely differ in cost and duration.",
    );
  });

  it("documents and threads the deliberate scripts-on opt-in", async () => {
    const help = await cli(["estimate", "--help"], seamsWith(new FakeAdapter(0.05)));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("before the full comparison");
    expect(help.stdout).not.toContain("before spending");
    expect(help.stdout).toContain("--install-mode <mode>");
    expect(help.stdout).toContain("--timeout <ms>");
    expect(help.stdout).toContain("--max-concurrency <n>");
    expect(help.stdout).toContain("repository-controlled scripts");
    expect(help.stdout.replace(/\s+/g, " ")).toContain("MUST only be used for refs you trust");

    const worktrees = fakeWorktrees(sha);
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--install-mode", "scripts-on"],
      {
        adapter: new FakeAdapter(0.05),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("scripts-on install mode will execute repository-controlled");
    expect(worktrees.options).toEqual([
      { installDirs: [], installMode: "scripts-on", resolvedCommitSha: sha },
    ]);
  });

  it("forwards --timeout and --max-concurrency from the CLI to the measurement run", async () => {
    const adapter = new FakeAdapter(0.05);
    const result = await cli(
      [
        "estimate",
        "--base",
        "main",
        "--repo",
        repo,
        "--timeout",
        "45000",
        "--max-concurrency",
        "2",
      ],
      seamsWith(adapter),
    );

    expect(result.code).toBe(0);
    expect(adapter.runOptions[0]).toMatchObject({ timeoutMs: 45_000, maxConcurrency: 2 });
  });

  it("rejects unknown install modes before creating a worktree", async () => {
    const worktrees = fakeWorktrees(sha);
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--install-mode", "unsafe"],
      {
        adapter: new FakeAdapter(0.05),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
      },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Allowed choices are scripts-off, scripts-on, safe, trusted");
    expect(worktrees.created).toEqual([]);
  });

  it("accepts deprecated install-mode aliases and normalizes them", async () => {
    const worktrees = fakeWorktrees(sha);
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--install-mode", "trusted"],
      {
        adapter: new FakeAdapter(0.05),
        createWorktree: worktrees.factory,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
        ...fakeGitAndCache,
      },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("--install-mode trusted is deprecated; use scripts-on");
    expect(worktrees.options[0]?.installMode).toBe("scripts-on");
  });

  it("returns the conventional exit code when an eval is interrupted", async () => {
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo],
      seamsWith(new InterruptedAdapter(0.05)),
    );
    expect(result.code).toBe(143);
    expect(result.stderr).toContain("diff0: interrupted by SIGTERM");
  });

  it("exits 4 when the projection exceeds --max-spend", async () => {
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--runs", "3", "--max-spend", "0.25"],
      seamsWith(new FakeAdapter(0.05)),
    );

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("projected cost $0.3000 exceeds --max-spend $0.2500");
  });

  it("exits 0 when the projection fits under --max-spend", async () => {
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--runs", "3", "--max-spend", "0.50"],
      seamsWith(new FakeAdapter(0.05)),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("projected cost $0.3000 is within --max-spend $0.5000");
  });

  it("explains that an unmeasurable cost cannot enforce the cap ahead of time (exit 0)", async () => {
    const result = await cli(
      ["estimate", "--base", "main", "--repo", repo, "--max-spend", "0.25"],
      seamsWith(new FakeAdapter(null)),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`cost per run:    unavailable — model ${FAKE_MODEL}`);
    expect(result.stdout).toContain("is not in prices.json");
    expect(result.stdout).toContain("the comparison will run but report cost as unavailable");
    expect(result.stdout).toContain("projected cost:  unavailable");
    expect(result.stderr).toContain("cannot be enforced ahead of time");
    expect(result.stderr).toContain("still enforces the cap at run time");
  });

  it("exits 2 on an unknown ref", async () => {
    const result = await cli(
      ["estimate", "--base", "nope", "--repo", repo],
      seamsWith(new FakeAdapter(0.05)),
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Ref "nope" was not found');
  });
});
