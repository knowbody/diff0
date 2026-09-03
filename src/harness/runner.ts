/**
 * N-run comparison orchestration: worktrees for both refs, probe, one
 * sandbox inference for the whole comparison, base-ref cache consultation,
 * and INTERLEAVED execution (base run 1, head run 1, base run 2, ...) so
 * time-of-day provider drift lands on both refs evenly.
 *
 * Collaborators are injectable (adapter, worktree factory, sandbox probe,
 * agent-info probe) so the interleaving/cache/cleanup logic is unit-testable
 * without eve or real worktrees.
 */

import { join } from "node:path";
import {
  CommandInterruptedError,
  EvalFilterNoMatchError,
  EveCliAdapter,
  getAgentInfo,
} from "../adapters/eve.js";
import { computeCacheKey, readCache, writeCache } from "../collect/cache.js";
import { applyPricing } from "../collect/pricing.js";
import { formatUsd } from "../report/format.js";
import type {
  AgentInfo,
  DependencyInstallMode,
  EveAdapter,
  RunOptions,
  RunRecord,
  SandboxBackend,
} from "../types.js";
import { type InferredSandboxBackend, inferSandboxBackend } from "./sandbox.js";
import {
  type CreateWorktreeOptions,
  createWorktree,
  normalizeAppDirectory,
  resolveRef,
  type WorktreeHandle,
} from "./worktree.js";

/** A single eval-suite invocation crashed; carries which ref and which run. */
export class EvalRunError extends Error {
  readonly side: "base" | "head";
  readonly ref: string;
  readonly runIndex: number;

  constructor(side: "base" | "head", ref: string, runIndex: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${side} run ${runIndex + 1} (ref ${ref}) failed: ${detail}`, { cause });
    this.name = "EvalRunError";
    this.side = side;
    this.ref = ref;
    this.runIndex = runIndex;
  }
}

/**
 * The cumulative MEASURED cost of this comparison's executed runs crossed the
 * --max-spend cap. Enforcement happens at run boundaries (after each completed
 * suite run), never mid-run: a suite invocation is atomic, so the final spend
 * can overshoot the cap by at most one run's cost. Cached base runs cost
 * nothing in this invocation and never count toward the cap.
 */
export class MaxSpendExceededError extends Error {
  readonly spentUsd: number;
  readonly capUsd: number;
  /** Suite runs that completed (and were paid for) before the abort. */
  readonly completedRuns: number;
  /** Suite runs the full comparison would have executed. */
  readonly totalRuns: number;

  constructor(details: {
    spentUsd: number;
    capUsd: number;
    completedRuns: number;
    totalRuns: number;
  }) {
    super(
      `--max-spend exceeded: measured cost ${formatUsd(details.spentUsd)} after ` +
        `${details.completedRuns} of ${details.totalRuns} suite runs is over the ` +
        `${formatUsd(details.capUsd)} cap. Remaining runs aborted; partial results discarded.`,
    );
    this.name = "MaxSpendExceededError";
    this.spentUsd = details.spentUsd;
    this.capUsd = details.capUsd;
    this.completedRuns = details.completedRuns;
    this.totalRuns = details.totalRuns;
  }
}

/** Cumulative spend snapshot passed to onSpend after every executed suite run. */
export interface SpendUpdate {
  /**
   * Cumulative measured cost of the runs executed so far in THIS invocation
   * (gateway cost, or prices.json fallback). null = nothing measurable yet —
   * never reported as $0, per the honest-framing rules.
   */
  spentUsd: number | null;
  completedRuns: number;
  totalRuns: number;
}

export interface RunComparisonOptions {
  repoPath: string;
  /** Path of the eve app within the repo ("." for the repo root). */
  appDir: string;
  baseRef: string;
  headRef: string;
  runs: number;
  evalFilter: string[];
  /** Dependency lifecycle policy; scripts-off disables scripts and is the default. */
  installMode?: DependencyInstallMode;
  timeoutMs?: number;
  maxConcurrency?: number;
  /** Skip both reading and writing the base-ref cache. */
  noCache?: boolean;
  /**
   * Hard USD cap on cumulative MEASURED cost, checked after each suite run.
   * Crossing it throws MaxSpendExceededError (CLI exit 4). When cost is
   * unmeasurable (mock or unpriced models) the cap can never trigger.
   */
  maxSpendUsd?: number;
  /** Observability hook: cumulative measured spend after every executed run. */
  onSpend?: (update: SpendUpdate) => void;
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
  writeCache?: typeof writeCache;
}

export interface ComparisonRunMeta {
  baseSha: string;
  headSha: string;
  baseEveVersion: string;
  headEveVersion: string;
  sandboxBackend: SandboxBackend;
  /** Always true in v1: eve never reports its pick, diff0 replicates the probe. */
  sandboxInferred: true;
  baseCacheHit: boolean;
  runsPerRef: number;
}

export interface ComparisonResult {
  baseRuns: RunRecord[];
  headRuns: RunRecord[];
  meta: ComparisonRunMeta;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function runSummaryPhrase(record: RunRecord): string {
  const passed = record.evalResults.filter((e) => e.passed).length;
  return `${passed}/${record.evalResults.length} evals passed, ${formatSeconds(record.durationMs)}`;
}

export async function runComparison(opts: RunComparisonOptions): Promise<ComparisonResult> {
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error(`runs must be a positive integer (got ${opts.runs})`);
  }
  const appDir = normalizeAppDirectory(opts.appDir);
  const progress = opts.onProgress ?? (() => {});
  if (opts.installMode === "scripts-on") {
    progress(
      "warning: scripts-on install mode will execute repository-controlled lifecycle/build scripts " +
        "from both refs; non-registry credentials are scrubbed, but package-registry auth remains available",
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
  const saveCache = opts.writeCache ?? writeCache;

  // Fail fast on unknown refs BEFORE paying for any worktree install.
  const baseSha = await resolveGitRef(opts.repoPath, opts.baseRef);
  const headSha = await resolveGitRef(opts.repoPath, opts.headRef);

  const worktrees: WorktreeHandle[] = [];
  try {
    progress(`preparing base worktree (${opts.baseRef} @ ${shortSha(baseSha)})…`);
    const baseWorktree = await makeWorktree(opts.repoPath, opts.baseRef, baseSha);
    if (baseWorktree.commitSha !== baseSha) {
      await baseWorktree.cleanup().catch(() => {});
      throw new Error(
        `base worktree commit mismatch: resolved ${baseSha}, checked out ${baseWorktree.commitSha}`,
      );
    }
    worktrees.push(baseWorktree);
    progress(`preparing head worktree (${opts.headRef} @ ${shortSha(headSha)})…`);
    const headWorktree = await makeWorktree(opts.repoPath, opts.headRef, headSha);
    if (headWorktree.commitSha !== headSha) {
      await headWorktree.cleanup().catch(() => {});
      throw new Error(
        `head worktree commit mismatch: resolved ${headSha}, checked out ${headWorktree.commitSha}`,
      );
    }
    worktrees.push(headWorktree);

    const baseCwd = join(baseWorktree.path, appDir);
    const headCwd = join(headWorktree.path, appDir);

    // Probe both refs: eve version + eval presence (NoEvalsError propagates).
    const baseProbe = await adapter.probe(baseCwd);
    const headProbe = await adapter.probe(headCwd);
    progress(
      `probed eve: base ${baseProbe.eveVersion} (${baseProbe.evalIds.length} evals), ` +
        `head ${headProbe.eveVersion} (${headProbe.evalIds.length} evals)`,
    );

    // One sandbox inference for the WHOLE comparison: both refs are
    // guaranteed to be labeled with the same inferred host conditions.
    const sandbox = await inferSandbox();
    progress(`sandbox backend (inferred): ${sandbox.backend}`);

    // Base-ref cache consultation.
    let baseRuns: RunRecord[] = [];
    let baseCacheHit = false;
    let cacheKey: string | null = null;
    if (opts.noCache !== true) {
      const info = await probeAgentInfo(baseCwd);
      const model = info?.model ?? "unknown";
      if (model === "unknown") {
        progress(
          'note: could not resolve the model id (eve info); base cache key uses "unknown", ' +
            "which is marginally less safe against model changes",
        );
      }
      cacheKey = computeCacheKey({
        appDir,
        commitSha: baseSha,
        eveVersion: baseProbe.eveVersion,
        model,
        evalFilter: opts.evalFilter,
        sandboxBackend: sandbox.backend,
        installMode: opts.installMode ?? "scripts-off",
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
      });
      const cached = await loadCache(opts.repoPath, cacheKey);
      if (cached !== null && cached.length >= opts.runs) {
        baseRuns = cached.slice(0, opts.runs);
        baseCacheHit = true;
        progress(
          `base cache hit (${cacheKey.slice(0, 8)}): reusing ${opts.runs} of ` +
            `${cached.length} cached base runs — running head only`,
        );
      } else {
        progress(`base cache miss (${cacheKey.slice(0, 8)}): running base fresh`);
      }
    }

    const runOptionsFor = (cwd: string, runIndex: number): RunOptions => {
      const runOptions: RunOptions = {
        cwd,
        runIndex,
        evalFilter: opts.evalFilter,
        sandboxBackend: sandbox.backend,
      };
      if (opts.timeoutMs !== undefined) runOptions.timeoutMs = opts.timeoutMs;
      if (opts.maxConcurrency !== undefined) runOptions.maxConcurrency = opts.maxConcurrency;
      return runOptions;
    };

    // Interleaved execution: base i, head i, base i+1, head i+1, ...
    const headRuns: RunRecord[] = [];
    const totalRuns = baseCacheHit ? opts.runs : opts.runs * 2;
    let completed = 0;

    // --max-spend bookkeeping. Only runs EXECUTED by this invocation count
    // (cached base runs were paid for by an earlier comparison). Costs are
    // measured with the same pricing pass the report uses; a record with no
    // cost source contributes nothing — an unmeasurable cost is unknown, not
    // $0, so a fully unpriced comparison can never trip the cap.
    const executedRecords: RunRecord[] = [];
    const trackSpend = opts.maxSpendUsd !== undefined || opts.onSpend !== undefined;
    const checkSpend = (): void => {
      if (!trackSpend) return;
      const { records } = applyPricing(executedRecords);
      const measured = records.filter((r) => r.costUsd !== null);
      const spentUsd =
        measured.length > 0 ? measured.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) : null;
      opts.onSpend?.({ spentUsd, completedRuns: completed, totalRuns });
      if (opts.maxSpendUsd !== undefined && spentUsd !== null && spentUsd > opts.maxSpendUsd) {
        throw new MaxSpendExceededError({
          spentUsd,
          capUsd: opts.maxSpendUsd,
          completedRuns: completed,
          totalRuns,
        });
      }
    };

    for (let i = 0; i < opts.runs; i++) {
      if (!baseCacheHit) {
        let record: RunRecord;
        try {
          record = await adapter.runEvalSuite(opts.baseRef, baseSha, runOptionsFor(baseCwd, i));
        } catch (error) {
          if (error instanceof EvalFilterNoMatchError || error instanceof CommandInterruptedError) {
            throw error;
          }
          throw new EvalRunError("base", opts.baseRef, i, error);
        }
        baseRuns.push(record);
        executedRecords.push(record);
        completed += 1;
        progress(`[${completed}/${totalRuns}] base run ${i + 1}: ${runSummaryPhrase(record)}`);
        checkSpend();
      }
      let record: RunRecord;
      try {
        record = await adapter.runEvalSuite(opts.headRef, headSha, runOptionsFor(headCwd, i));
      } catch (error) {
        if (error instanceof EvalFilterNoMatchError || error instanceof CommandInterruptedError) {
          throw error;
        }
        throw new EvalRunError("head", opts.headRef, i, error);
      }
      headRuns.push(record);
      executedRecords.push(record);
      completed += 1;
      progress(`[${completed}/${totalRuns}] head run ${i + 1}: ${runSummaryPhrase(record)}`);
      checkSpend();
    }

    // Persist fresh base runs for the next comparison against this base.
    if (cacheKey !== null && !baseCacheHit) {
      try {
        await saveCache(opts.repoPath, cacheKey, baseRuns);
        progress(`wrote base cache (${cacheKey.slice(0, 8)})`);
      } catch (error) {
        progress(
          `warning: failed to write base cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      baseRuns,
      headRuns,
      meta: {
        baseSha,
        headSha,
        baseEveVersion: baseProbe.eveVersion,
        headEveVersion: headProbe.eveVersion,
        sandboxBackend: sandbox.backend,
        sandboxInferred: true,
        baseCacheHit,
        runsPerRef: opts.runs,
      },
    };
  } finally {
    for (const worktree of worktrees) {
      try {
        await worktree.cleanup();
      } catch {
        // Best-effort: never mask the primary error with a cleanup failure.
      }
    }
  }
}
