/**
 * `diff0 estimate` — measure ONE eval-suite pass, project the cost and
 * duration of the full N-run comparison before that full comparison runs.
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

import type { CostSource } from "../analyze/types.js";
import { applyPricing } from "../collect/pricing.js";
import { usableCosts } from "../cost.js";
import { median } from "../numeric.js";
import { validateCollectionOptions } from "../options.js";
import type { DependencyInstallMode, RunOptions, RunRecord } from "../types.js";
import { cleanupResources } from "./cleanup.js";
import { harnessDependencies, type InjectableHarness } from "./dependencies.js";
import { appCacheKey, prepareApp } from "./preparation.js";
import { normalizeAppDirectory } from "./worktree.js";

export interface EstimateOptions extends InjectableHarness {
  /** Planned comparison cache reuse; false/omitted matches the default run. Evidence may still come from cache. */
  cache?: boolean;
  repoPath: string;
  /** Path of the eve app within the repo ("." for the repo root). */
  appDir: string;
  baseRef: string;
  headRef: string;
  /** Planned runs per ref of the full comparison being projected. */
  runs: number;
  evalFilter: string[];
  /** Per-eval timeout forwarded to eve and included in the base-cache key. */
  timeoutMs?: number;
  /** Suite concurrency forwarded to eve and included in the base-cache key. */
  maxConcurrency?: number;
  /** Dependency lifecycle policy; scripts-off disables scripts and is the default. */
  installMode?: DependencyInstallMode;
  onProgress?: (message: string) => void;

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
  /** Cache policy assumed for the planned comparison, separate from sample source. */
  plannedCacheReuse: boolean;
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

export async function runEstimate(opts: EstimateOptions): Promise<Estimate> {
  validateCollectionOptions(opts);
  const appDir = normalizeAppDirectory(opts.appDir);
  const progress = opts.onProgress ?? (() => {});
  if (opts.installMode === "scripts-on") {
    progress(
      "warning: scripts-on install mode will execute repository-controlled lifecycle/build scripts " +
        "from the sampled ref; non-registry credentials are scrubbed, but package-registry auth remains available",
    );
  }
  const dependencies = harnessDependencies(opts);
  const { adapter, resolveRef: resolveGitRef, readCache: loadCache, inferSandbox } = dependencies;

  // Fail fast on unknown refs BEFORE paying for any worktree install.
  const baseSha = await resolveGitRef(opts.repoPath, opts.baseRef);
  const headSha = await resolveGitRef(opts.repoPath, opts.headRef);

  progress(`preparing head worktree (${opts.headRef} @ ${shortSha(headSha)})…`);
  const headApp = await prepareApp(
    { ...opts, appDir },
    opts.headRef,
    headSha,
    dependencies,
    opts.onProgress,
  );
  try {
    const headCwd = headApp.cwd;
    const headProbe = headApp.probe;
    progress(`probed eve ${headProbe.eveVersion} (${headProbe.evalIds.length} evals)`);

    // Base-cache consultation with the runner's key logic. The estimate never
    // builds a base worktree, so the eve version and model inputs come from
    // the head worktree — identical to the runner's base-probed values
    // whenever both refs agree on Eve + model. This provides estimation
    // evidence, not a guarantee of reuse: runComparison probes the base and
    // checks its actual metadata before accepting the cache.
    const info = headApp.agentInfo;
    const model = info?.model ?? "unknown";
    // Host default capability affects execution semantics when an app does
    // not override it, so it remains a conservative cache-key input. It is
    // not evidence of the actual sandbox selected by this app.
    const sandbox = await inferSandbox();
    const cacheKey = appCacheKey({ ...opts, appDir }, headApp, baseSha, sandbox.backend);
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
        sandboxBackend: "unknown",
      };
      if (opts.timeoutMs !== undefined) runOptions.timeoutMs = opts.timeoutMs;
      if (opts.maxConcurrency !== undefined) {
        runOptions.maxConcurrency = opts.maxConcurrency;
      }
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
    const costs = usableCosts(priced.records);
    const perRunCostUsd = costs === null ? null : median(costs);
    const perRunDurationMs = median(sample.map((r) => r.durationMs));

    const cachedBaseRuns = opts.cache === true && sampleSource === "base-cache" ? opts.runs : 0;
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
      plannedCacheReuse: opts.cache === true,
      chargeableRuns,
      projectedCostUsd: perRunCostUsd !== null ? perRunCostUsd * chargeableRuns : null,
      projectedDurationMs: perRunDurationMs * chargeableRuns,
    };
  } finally {
    await cleanupResources([headApp.worktree], opts.onProgress);
  }
}
