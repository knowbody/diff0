/** Node.js collection and comparison API. Output and exit policy belong to callers. */
import { computeDelta } from "./analyze/delta.js";
import type { DeltaReport, PerformanceThresholds } from "./analyze/types.js";
import { applyPricing } from "./collect/pricing.js";
import { getDiffStat } from "./harness/gitdiff.js";
import { type RunComparisonOptions, runComparison } from "./harness/runner.js";

export interface CompareRefsOptions extends RunComparisonOptions {
  /** Increase-only budgets used to classify performance regressions. */
  performanceThresholds?: Partial<PerformanceThresholds>;
}

/**
 * Collect both refs, apply bundled fallback pricing, and analyze the evidence.
 * Returns an internal report containing fingerprints; use toPublicReport or
 * renderJson from the reporters entrypoint before publishing it.
 * Cache reuse is opt-in here, matching the CLI. Failures reject the promise.
 */
export async function compareRefs(options: CompareRefsOptions): Promise<DeltaReport> {
  const { baseRuns, headRuns, meta } = await runComparison({
    ...options,
    noCache: options.noCache ?? true,
  });
  const priced = applyPricing([...baseRuns, ...headRuns]);
  const gitDiffStat = await getDiffStat(options.repoPath, meta.baseSha, meta.headSha);
  return computeDelta(
    priced.records.slice(0, baseRuns.length),
    priced.records.slice(baseRuns.length),
    {
      sandboxInferred: meta.sandboxInferred,
      hostDefaultSandboxCandidate: meta.hostDefaultSandboxCandidate,
      gitDiffStat,
      baseCacheHit: meta.baseCacheHit,
      validityMismatches: meta.validityMismatches,
      ...(options.performanceThresholds === undefined
        ? {}
        : { performanceThresholds: options.performanceThresholds }),
      ...(priced.costSource === "unavailable" ? {} : { costSource: priced.costSource }),
    },
  );
}

export { CommandInterruptedError, EvalFilterNoMatchError, NoEvalsError } from "./adapters/eve.js";
export { type Estimate, type EstimateOptions, runEstimate } from "./harness/estimate.js";
export {
  type ComparisonResult,
  type ComparisonRunMeta,
  EvalRunError,
  MaxSpendExceededError,
  type RunComparisonOptions,
  runComparison,
  type SpendUpdate,
} from "./harness/runner.js";
