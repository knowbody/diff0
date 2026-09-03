/**
 * `diff0 estimate` — measure ONE eval-suite pass, project the cost and
 * duration of the full N-run comparison before any real money is spent.
 *
 * Reuses the exact worktree / adapter / cache / pricing machinery of the
 * runner — there is no second eve-invocation code path. Interleaving is
 * irrelevant for a single measurement pass, so at most one worktree (head)
 * is ever created:
 *
 * - Fresh base cache (same key logic as the runner)? Its records are the
 *   measurement sample — zero eval runs, zero spend.
 * - Otherwise the suite runs ONCE on the head worktree and that single
 *   record is the sample.
 *
 * Honest-framing rules apply: a cost that cannot be measured is reported
 * unavailable (never $0), and every projection carries the caveat that base
 * and head may genuinely differ in cost and duration.
 */

import { join } from "node:path";
import { EveCliAdapter, getAgentInfo } from "../adapters/eve.js";
import type { CostSource } from "../analyze/types.js";
import { computeCacheKey, readCache } from "../collect/cache.js";
import { applyPricing } from "../collect/pricing.js";
import type {
  AgentInfo,
  DependencyInstallMode,
  EveAdapter,
  RunOptions,
  RunRecord,
} from "../types.js";
import { type InferredSandboxBackend, inferSandboxBackend } from "./sandbox.js";
import {
  type CreateWorktreeOptions,
  createWorktree,
  normalizeAppDirectory,
  resolveRef,
  type WorktreeHandle,
} from "./worktree.js";

export interface EstimateOptions {
  repoPath: string;
  /** Path of the eve app within the repo ("." for the repo root). */
  appDir: string;
  baseRef: string;
  headRef: string;
  /** Planned runs per ref of the full comparison being projected. */
  runs: number;
  evalFilter: string[];
  /** Dependency lifecycle policy; scripts-off disables scripts and is the default. */
  installMode?: DependencyInstallMode;
  onProgress?: (message: string) => void;

  // -- dependency-injection seams (tests only; defaults are the real thing) --
  adapter?: EveAdapter;
  createWorktree?: (
    repoPath: string,
    ref: string,
    opts?: CreateWorktreeOptions,
  ) => Promise<WorktreeHandle>;
  inferSandbox?: () => Promise<InferredSandboxBackend>;
  getAgentInfo?: (cwd: string) => Promise<AgentInfo | null>;
  /** Git/cache seams keep orchestration tests free of subprocess and filesystem timing. */
  resolveRef?: typeof resolveRef;
  readCache?: typeof readCache;
  /** Override the prices.json path (tests). */
  pricesPath?: string;
}

export interface Estimate {
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  /** Where the measurement sample came from. */
  sampleSource: "base-cache" | "head-run";
  /** Number of records in the measurement sample (cached N, or 1 fresh run). */
  sampleRuns: number;
  /** Model id of the sampled runs ("unknown" when unresolvable). */
  model: string;
  /** Evals executed per suite run, from the sample (probe count as fallback). */
  evalsPerRun: number;
  /** Median measured cost of one suite run; null = no cost source (NOT $0). */
  perRunCostUsd: number | null;
  costSource: CostSource;
  /** Median measured wall-clock of one suite run. */
  perRunDurationMs: number;
  /** Planned runs per ref (the --runs value being projected). */
  runsPerRef: number;
  /** runsPerRef x 2 refs. */
  totalRuns: number;
  /** Base runs already covered by a fresh cache (0 or runsPerRef). */
  cachedBaseRuns: number;
  /** Suite runs the full comparison would actually execute and pay for. */
  chargeableRuns: number;
  /** perRunCostUsd x chargeableRuns; null when cost is unavailable. */
  projectedCostUsd: number | null;
  /** perRunDurationMs x chargeableRuns (runs execute sequentially). */
  projectedDurationMs: number;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (sorted.length % 2 === 0 && lower !== undefined && upper !== undefined) {
    return (lower + upper) / 2;
  }
  return upper ?? 0;
}

export async function runEstimate(opts: EstimateOptions): Promise<Estimate> {
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error(`runs must be a positive integer (got ${opts.runs})`);
  }
  const appDir = normalizeAppDirectory(opts.appDir);
  const progress = opts.onProgress ?? (() => {});
  if (opts.installMode === "scripts-on") {
    progress(
      "warning: scripts-on install mode will execute repository-controlled lifecycle/build scripts " +
        "from the sampled ref; non-registry credentials are scrubbed, but package-registry auth remains available",
    );
  }
  const adapter = opts.adapter ?? new EveCliAdapter();
  const worktreeFactory = opts.createWorktree ?? createWorktree;
  const makeWorktree = (repoPath: string, ref: string, resolvedCommitSha: string) =>
    worktreeFactory(repoPath, ref, {
      installDirs: appDir === "." ? [] : [appDir],
      installMode: opts.installMode ?? "scripts-off",
      resolvedCommitSha,
    });
  const inferSandbox = opts.inferSandbox ?? inferSandboxBackend;
  const probeAgentInfo = opts.getAgentInfo ?? getAgentInfo;
  const resolveGitRef = opts.resolveRef ?? resolveRef;
  const loadCache = opts.readCache ?? readCache;

  // Fail fast on unknown refs BEFORE paying for any worktree install.
  const baseSha = await resolveGitRef(opts.repoPath, opts.baseRef);
  const headSha = await resolveGitRef(opts.repoPath, opts.headRef);

  progress(`preparing head worktree (${opts.headRef} @ ${shortSha(headSha)})…`);
  const headWorktree = await makeWorktree(opts.repoPath, opts.headRef, headSha);
  if (headWorktree.commitSha !== headSha) {
    await headWorktree.cleanup().catch(() => {});
    throw new Error(
      `head worktree commit mismatch: resolved ${headSha}, checked out ${headWorktree.commitSha}`,
    );
  }
  try {
    const headCwd = join(headWorktree.path, appDir);

    // Probe validates eve + eval presence (NoEvalsError propagates → exit 2).
    const headProbe = await adapter.probe(headCwd);
    progress(`probed eve ${headProbe.eveVersion} (${headProbe.evalIds.length} evals)`);

    // Base-cache consultation with the runner's key logic. The estimate never
    // builds a base worktree, so the eve version and model inputs come from
    // the head worktree — identical to the runner's base-probed values
    // whenever both refs agree on eve + model (which a valid comparison
    // requires anyway). When they differ, the key simply misses: conservative
    // (one measured run) rather than ever reusing a stale sample.
    const info = await probeAgentInfo(headCwd);
    const model = info?.model ?? "unknown";
    // Sandbox choice affects execution semantics and is therefore part of the
    // cache key. Probe it before cache lookup so estimate and run share the
    // exact same compatibility boundary.
    const sandbox = await inferSandbox();
    const cacheKey = computeCacheKey({
      appDir,
      commitSha: baseSha,
      eveVersion: headProbe.eveVersion,
      model,
      evalFilter: opts.evalFilter,
      sandboxBackend: sandbox.backend,
      installMode: opts.installMode ?? "scripts-off",
    });
    const cached = await loadCache(opts.repoPath, cacheKey);

    let sample: RunRecord[];
    let sampleSource: Estimate["sampleSource"];
    if (cached !== null && cached.length >= opts.runs) {
      sample = cached.slice(0, opts.runs);
      sampleSource = "base-cache";
      progress(
        `base cache hit (${cacheKey.slice(0, 8)}): using ${sample.length} cached base ` +
          "runs as the measurement sample — no eval run needed",
      );
    } else {
      progress(`measurement pass: running the suite once on head (${opts.headRef})…`);
      const runOptions: RunOptions = {
        cwd: headCwd,
        runIndex: 0,
        evalFilter: opts.evalFilter,
        sandboxBackend: sandbox.backend,
      };
      const record = await adapter.runEvalSuite(opts.headRef, headSha, runOptions);
      sample = [record];
      sampleSource = "head-run";
      const passed = record.evalResults.filter((e) => e.passed).length;
      progress(
        `measured: ${passed}/${record.evalResults.length} evals passed, ` +
          `${(record.durationMs / 1000).toFixed(1)}s`,
      );
    }

    // Same pricing pass the report uses: gateway cost wins, prices.json is
    // the fallback, and anything unpriced keeps the whole sample honest by
    // reporting "unavailable" instead of a partial (misleading) figure.
    const priced = applyPricing(
      sample,
      opts.pricesPath !== undefined ? { pricesPath: opts.pricesPath } : {},
    );
    const costs = priced.records
      .map((r) => r.costUsd)
      .filter((c): c is number => c !== null && c > 0);
    const perRunCostUsd =
      priced.costSource !== "unavailable" && costs.length === sample.length ? median(costs) : null;
    const perRunDurationMs = median(sample.map((r) => r.durationMs));

    const cachedBaseRuns = sampleSource === "base-cache" ? opts.runs : 0;
    const totalRuns = opts.runs * 2;
    const chargeableRuns = totalRuns - cachedBaseRuns;

    const firstRecord = sample[0];
    const sampleModel =
      firstRecord !== undefined && firstRecord.model !== "unknown" ? firstRecord.model : model;
    const evalsPerRun =
      firstRecord !== undefined && firstRecord.evalResults.length > 0
        ? firstRecord.evalResults.length
        : headProbe.evalIds.length;

    return {
      baseRef: opts.baseRef,
      headRef: opts.headRef,
      baseSha,
      headSha,
      sampleSource,
      sampleRuns: sample.length,
      model: sampleModel,
      evalsPerRun,
      perRunCostUsd,
      costSource: perRunCostUsd !== null ? priced.costSource : "unavailable",
      perRunDurationMs,
      runsPerRef: opts.runs,
      totalRuns,
      cachedBaseRuns,
      chargeableRuns,
      projectedCostUsd: perRunCostUsd !== null ? perRunCostUsd * chargeableRuns : null,
      projectedDurationMs: perRunDurationMs * chargeableRuns,
    };
  } finally {
    try {
      await headWorktree.cleanup();
    } catch {
      // Best-effort: never mask the primary error with a cleanup failure.
    }
  }
}
