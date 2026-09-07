import type { EnforcementCategory, PerformanceThresholds } from "./types.js";

/** Median cost increase above which the comparison is flagged yellow. */
export const COST_DRIFT_THRESHOLD_PCT = 25;

/**
 * Conservative built-in directional budgets. Cost retains its existing 25% magnitude;
 * duration and token medians must more than double before they affect the verdict.
 * Decreases never violate these budgets.
 */
export const DEFAULT_PERFORMANCE_THRESHOLDS: Readonly<PerformanceThresholds> = {
  costUsd: COST_DRIFT_THRESHOLD_PCT,
  tokensIn: 100,
  tokensOut: 100,
  durationMs: 100,
};

export const ENFORCEMENT_CATEGORIES = [
  "eval-regression",
  "score-regression",
  "performance-regression",
  "behavioral-drift",
  "comparison-validity",
] as const satisfies readonly EnforcementCategory[];

/** Below this many runs per ref, borderline results trigger a --runs 5 recommendation. */
export const RECOMMENDED_RUNS = 5;

/** Directional significance threshold. Inclusive so 3/3 -> 0/3 (p=.05) is actionable. */
export const EVAL_ALPHA = 0.05;

/** Complete runs per ref required for the all-pass -> all-fail operational release gate. */
export const OPERATIONAL_REGRESSION_MIN_RUNS = 3;

/** Behavioral observations use a two-sided test and the same conventional threshold. */
export const DRIFT_ALPHA = 0.05;

/** Absolute median scorer drop that is material enough to require review. */
export const SOFT_SCORE_REGRESSION_THRESHOLD = 0.1;
