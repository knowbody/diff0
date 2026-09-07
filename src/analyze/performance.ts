import { usableCosts } from "../cost.js";
import { metricDelta } from "../numeric.js";
import type { RunRecord } from "../types.js";
import { DEFAULT_PERFORMANCE_THRESHOLDS } from "./constants.js";
import type {
  CostPerf,
  PerformanceMetric,
  PerformanceRegression,
  PerformanceThresholds,
} from "./types.js";
export function computeCostPerf(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  thresholdOverrides: Partial<PerformanceThresholds> = {},
): CostPerf {
  const costPerf: Omit<CostPerf, "regressions"> = {
    costUsd: metricDelta(usableCosts(baseRuns), usableCosts(headRuns)),
    tokensIn: metricDelta(
      baseRuns.map((r) => r.tokens.input),
      headRuns.map((r) => r.tokens.input),
    ),
    tokensOut: metricDelta(
      baseRuns.map((r) => r.tokens.output),
      headRuns.map((r) => r.tokens.output),
    ),
    cacheReadTokens: metricDelta(
      baseRuns.map((r) => r.tokens.cacheRead),
      headRuns.map((r) => r.tokens.cacheRead),
    ),
    cacheWriteTokens: metricDelta(
      baseRuns.map((r) => r.tokens.cacheWrite),
      headRuns.map((r) => r.tokens.cacheWrite),
    ),
    durationMs: metricDelta(
      baseRuns.map((r) => r.durationMs),
      headRuns.map((r) => r.durationMs),
    ),
  };
  const thresholds: PerformanceThresholds = {
    ...DEFAULT_PERFORMANCE_THRESHOLDS,
    ...thresholdOverrides,
  };
  validatePerformanceThresholds(thresholdOverrides);
  return {
    ...costPerf,
    regressions: performanceRegressions(costPerf, thresholds),
  };
}

const PERFORMANCE_METRICS: readonly PerformanceMetric[] = [
  "costUsd",
  "tokensIn",
  "tokensOut",
  "durationMs",
];

function performanceRegressions(
  costPerf: Omit<CostPerf, "regressions">,
  thresholds: PerformanceThresholds,
): PerformanceRegression[] {
  const regressions: PerformanceRegression[] = [];
  for (const metric of PERFORMANCE_METRICS) {
    const delta = costPerf[metric];
    const thresholdPct = thresholds[metric];
    if (
      delta.base !== null &&
      delta.head !== null &&
      exceedsBudget(delta.base.median, delta.head.median, thresholdPct)
    ) {
      regressions.push({
        metric,
        baseMedian: delta.base.median,
        headMedian: delta.head.median,
        deltaPct: delta.deltaPct,
        thresholdPct,
      });
    }
  }
  return regressions;
}

export function validatePerformanceThresholds(
  overrides: Partial<PerformanceThresholds> = {},
): void {
  const thresholds = { ...DEFAULT_PERFORMANCE_THRESHOLDS, ...overrides };
  for (const metric of PERFORMANCE_METRICS) {
    if (!Number.isFinite(thresholds[metric]) || thresholds[metric] < 0) {
      throw new Error(`computeDelta: performance threshold for ${metric} must be non-negative`);
    }
  }
}

/**
 * Compare amounts against the allowed boundary, not their cancellation-prone percentage.
 * Two machine-epsilon units absorb arithmetic noise only at floating-point resolution;
 * this tolerance scales with the amounts and never imposes display-level rounding.
 */
function exceedsBudget(base: number, head: number, thresholdPct: number): boolean {
  const allowed = base + base * (thresholdPct / 100);
  const arithmeticNoise = 2 * Number.EPSILON * Math.max(Math.abs(head), Math.abs(allowed));
  return head - allowed > arithmeticNoise;
}
