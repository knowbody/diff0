/**
 * N-run comparison orchestration: worktrees for both refs, probe, one
 * host-default sandbox capability probe, base-ref cache consultation,
 * and COUNTERBALANCED execution (AB, then BA) so provider/time-order drift
 * does not consistently advantage one ref.
 *
 * Collaborators are injectable (adapter, worktree factory, sandbox probe,
 * agent-info probe) so the run-order/cache/cleanup logic is unit-testable
 * without eve or real worktrees.
 */

import { CommandInterruptedError, EvalFilterNoMatchError } from "../adapters/eve.js";
import { applyPricing } from "../collect/pricing.js";
import { availableCost } from "../cost.js";
import { validateCollectionOptions } from "../options.js";
import { formatUsd } from "../report/format.js";
import type { DependencyInstallMode, RunOptions, RunRecord, SandboxBackend } from "../types.js";
import { cleanupResources } from "./cleanup.js";
import { harnessDependencies, type InjectableHarness } from "./dependencies.js";
import { appCacheKey, prepareApp } from "./preparation.js";
import { normalizeAppDirectory, type WorktreeHandle } from "./worktree.js";

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

export interface RunComparisonOptions extends InjectableHarness {
  repoPath: string;
  /** Path of the eve app within the repo ("." for the repo root). */
  appDir: string;
  baseRef: string;
  headRef: string;
  runs: number;
  evalFilter: string[];
  /**
   * Additional repo-relative globs whose changes can invalidate evaluator
   * comparability. Additive to the default <appDir>/evals/** match.
   */
  validityPatterns?: string[];
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
}

export interface ComparisonRunMeta {
  baseSha: string;
  headSha: string;
  baseEveVersion: string;
  headEveVersion: string;
  /** Actual sandbox backend is not observable from Eve's eval output. */
  sandboxBackend: "unknown";
  sandboxInferred: false;
  /** Host default only; authored app sandbox configuration may override it. */
  hostDefaultSandboxCandidate: SandboxBackend;
  baseCacheHit: boolean;
  runsPerRef: number;
  /** Preflight findings that cap an apparent regression at yellow. */
  validityMismatches: string[];
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
  validateCollectionOptions(opts);
  const appDir = normalizeAppDirectory(opts.appDir);
  const progress = opts.onProgress ?? (() => {});
  if (opts.installMode === "scripts-on") {
    progress(
      "warning: scripts-on install mode will execute repository-controlled lifecycle/build scripts " +
        "from both refs; non-registry credentials are scrubbed, but package-registry auth remains available",
    );
  }
  const dependencies = harnessDependencies(opts);
  const {
    adapter,
    resolveRef: resolveGitRef,
    readCache: loadCache,
    writeCache: saveCache,
    inferSandbox,
  } = dependencies;

  // Fail fast on unknown refs BEFORE paying for any worktree install.
  const baseSha = await resolveGitRef(opts.repoPath, opts.baseRef);
  const headSha = await resolveGitRef(opts.repoPath, opts.headRef);
  // Legacy inspectors remain injectable; a null result now explicitly caps validity.
  const legacyInspectors =
    opts.getEvalHarnessChanges !== undefined ||
    opts.getSandboxConfigChanges !== undefined ||
    opts.dependencies?.getEvalHarnessChanges !== undefined ||
    opts.dependencies?.getSandboxConfigChanges !== undefined;
  const inspection = legacyInspectors
    ? null
    : await dependencies.inspectValidity(
        opts.repoPath,
        baseSha,
        headSha,
        appDir,
        opts.validityPatterns,
      );
  const [evalHarnessChanges, sandboxConfigChanges] = legacyInspectors
    ? await Promise.all([
        dependencies.getEvalHarnessChanges(
          opts.repoPath,
          baseSha,
          headSha,
          appDir,
          opts.validityPatterns,
        ),
        dependencies.getSandboxConfigChanges(opts.repoPath, baseSha, headSha, appDir),
      ])
    : inspection?.status === "checked"
      ? [inspection.evalHarnessChanges, inspection.sandboxConfigChanges]
      : [null, null];
  const displayedEvalChanges = evalHarnessChanges?.slice(0, 5) ?? [];
  const omittedEvalChanges = (evalHarnessChanges?.length ?? 0) - displayedEvalChanges.length;
  const validityMismatches: string[] =
    evalHarnessChanges !== null && evalHarnessChanges.length > 0
      ? [
          `eval harness differs between refs (${evalHarnessChanges.length} file${evalHarnessChanges.length === 1 ? "" : "s"}): ` +
            `${displayedEvalChanges.join(", ")}${omittedEvalChanges > 0 ? `, and ${omittedEvalChanges} more` : ""}. ` +
            "Outcome changes may come from evaluator changes rather than agent behavior.",
        ]
      : [];
  if (evalHarnessChanges === null)
    validityMismatches.push(
      "eval harness validity inspection unavailable; evaluator comparability could not be established",
    );
  if (sandboxConfigChanges === null)
    validityMismatches.push(
      "sandbox configuration validity inspection unavailable; sandbox comparability could not be established",
    );
  if (sandboxConfigChanges !== null && sandboxConfigChanges.length > 0) {
    const displayed = sandboxConfigChanges.slice(0, 5);
    const omitted = sandboxConfigChanges.length - displayed.length;
    validityMismatches.push(
      `sandbox configuration differs between refs (${sandboxConfigChanges.length} file${sandboxConfigChanges.length === 1 ? "" : "s"}): ` +
        `${displayed.join(", ")}${omitted > 0 ? `, and ${omitted} more` : ""}. ` +
        "Diff0 cannot observe the actual backend selected by either ref, so behavior may reflect sandbox changes.",
    );
  }
  for (const mismatch of validityMismatches) progress(`warning: ${mismatch}`);

  const worktrees: WorktreeHandle[] = [];
  try {
    progress(`preparing base worktree (${opts.baseRef} @ ${shortSha(baseSha)})…`);
    const baseApp = await prepareApp(
      { ...opts, appDir },
      opts.baseRef,
      baseSha,
      dependencies,
      opts.onProgress,
    );
    worktrees.push(baseApp.worktree);
    progress(`preparing head worktree (${opts.headRef} @ ${shortSha(headSha)})…`);
    const headApp = await prepareApp(
      { ...opts, appDir },
      opts.headRef,
      headSha,
      dependencies,
      opts.onProgress,
    );
    worktrees.push(headApp.worktree);
    const baseCwd = baseApp.cwd;
    const headCwd = headApp.cwd;
    const baseProbe = baseApp.probe;
    const headProbe = headApp.probe;
    progress(
      `probed eve: base ${baseProbe.eveVersion} (${baseProbe.evalIds.length} evals), ` +
        `head ${headProbe.eveVersion} (${headProbe.evalIds.length} evals)`,
    );

    // This is only a host-default candidate. Authored sandbox configuration
    // can override it independently in either ref, and Eve does not expose
    // the actual selection in eval output.
    const sandbox = await inferSandbox();
    progress(
      `host default sandbox candidate: ${sandbox.backend} (actual app sandbox is not observable)`,
    );

    // Base-ref cache consultation.
    let baseRuns: RunRecord[] = [];
    let baseCacheHit = false;
    let cacheKey: string | null = null;
    if (opts.noCache !== true) {
      const info = baseApp.agentInfo;
      const model = info?.model ?? "unknown";
      if (model === "unknown") {
        progress(
          'note: could not resolve the model id (eve info); base cache key uses "unknown", ' +
            "which is marginally less safe against model changes",
        );
      }
      cacheKey = appCacheKey({ ...opts, appDir }, baseApp, baseSha, sandbox.backend);
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
        sandboxBackend: "unknown",
      };
      if (opts.timeoutMs !== undefined) runOptions.timeoutMs = opts.timeoutMs;
      if (opts.maxConcurrency !== undefined) runOptions.maxConcurrency = opts.maxConcurrency;
      return runOptions;
    };

    // Counterbalanced execution: base/head on even runs, head/base on odd
    // runs. This spreads provider warm-up and time-order effects across refs.
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
      const measured = records.map(availableCost).filter((cost): cost is number => cost !== null);
      const spentUsd = measured.length > 0 ? measured.reduce((sum, cost) => sum + cost, 0) : null;
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

    const runSide = async (side: "base" | "head", runIndex: number): Promise<void> => {
      const isBase = side === "base";
      const ref = isBase ? opts.baseRef : opts.headRef;
      const commitSha = isBase ? baseSha : headSha;
      const cwd = isBase ? baseCwd : headCwd;
      let record: RunRecord;
      try {
        record = await adapter.runEvalSuite(ref, commitSha, runOptionsFor(cwd, runIndex));
      } catch (error) {
        if (error instanceof EvalFilterNoMatchError || error instanceof CommandInterruptedError) {
          throw error;
        }
        throw new EvalRunError(side, ref, runIndex, error);
      }
      (isBase ? baseRuns : headRuns).push(record);
      executedRecords.push(record);
      completed += 1;
      progress(
        `[${completed}/${totalRuns}] ${side} run ${runIndex + 1}: ${runSummaryPhrase(record)}`,
      );
      checkSpend();
    };

    for (let i = 0; i < opts.runs; i++) {
      if (baseCacheHit) {
        await runSide("head", i);
        continue;
      }
      const order: Array<"base" | "head"> = i % 2 === 0 ? ["base", "head"] : ["head", "base"];
      for (const side of order) {
        await runSide(side, i);
      }
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
        sandboxBackend: "unknown",
        sandboxInferred: false,
        hostDefaultSandboxCandidate: sandbox.backend,
        baseCacheHit,
        runsPerRef: opts.runs,
        validityMismatches,
      },
    };
  } finally {
    await cleanupResources(worktrees, opts.onProgress);
  }
}
