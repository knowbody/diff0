import type { DeltaReport, EvalDelta } from "../analyze/types.js";
import { metricDelta } from "../numeric.js";
import { formatDuration, formatInt, formatUsd } from "./format.js";

/** Summary claims require full run coverage, including evals absent from some runs. */
export function overviewFacts(report: DeltaReport) {
  const allPassed = (passed: number, observed: number, expected: number) =>
    expected > 0 && observed === expected && passed === expected;
  return {
    basePassing: report.evals.filter((e) =>
      allPassed(e.basePassed, e.baseTotal, e.baseExpectedRuns),
    ).length,
    headPassing: report.evals.filter((e) =>
      allPassed(e.headPassed, e.headTotal, e.headExpectedRuns),
    ).length,
    toolCalls: metricDelta(
      report.runSummaries.base.map((run) => run.toolCallCount),
      report.runSummaries.head.map((run) => run.toolCallCount),
    ),
  };
}

/** Target-independent evaluation detail, with target-specific punctuation applied by renderers. */
export function evalFacts(e: EvalDelta) {
  const coverage: string[] = [];
  if (e.status === "partial-base" || e.status === "partial-head" || e.status === "partial-both") {
    if (e.baseTotal < e.baseExpectedRuns)
      coverage.push(`base ${e.baseTotal}/${e.baseExpectedRuns} runs`);
    if (e.headTotal < e.headExpectedRuns)
      coverage.push(`head ${e.headTotal}/${e.headExpectedRuns} runs`);
  }
  return {
    coverage: coverage.length > 0 ? `coverage ${coverage.join(", ")}` : null,
    score: e.softScores
      ? {
          base: e.softScores.baseMedian,
          head: e.softScores.headMedian,
          delta: `${e.softScores.delta >= 0 ? "+" : ""}${e.softScores.delta}`,
          changed: e.softScores.delta !== 0,
          materialThreshold:
            e.softScores.classification === "material-regression"
              ? e.softScores.materialThreshold
              : null,
        }
      : null,
    hint: e.twoProportionHint?.note ?? null,
    fisher:
      e.statisticalEvidence.pValue === null ? null : formatPValue(e.statisticalEvidence.pValue),
    holm:
      e.statisticalEvidence.adjustedPValue === null
        ? null
        : formatPValue(e.statisticalEvidence.adjustedPValue),
  };
}

export function formatPValue(value: number): string {
  return value < 0.0001 ? "<0.0001" : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

const PERFORMANCE_LABELS = {
  costUsd: { markdown: "Cost / session", terminal: "cost/session" },
  tokensIn: { markdown: "Uncached input tokens", terminal: "uncached input tokens" },
  tokensOut: { markdown: "Output tokens", terminal: "output tokens" },
  durationMs: { markdown: "Duration", terminal: "duration" },
};

/** Preserve enough precision that a budget explanation never says '+10% exceeds +10%'. */
export function performanceBudgetFacts(
  regression: import("../analyze/types.js").PerformanceRegression,
) {
  const labels = PERFORMANCE_LABELS[regression.metric];
  if (regression.deltaPct === null) {
    const amount =
      regression.metric === "costUsd"
        ? formatUsd
        : regression.metric === "durationMs"
          ? formatDuration
          : formatInt;
    return {
      labels,
      delta: null,
      threshold: `+${regression.thresholdPct}%`,
      text:
        `median increased from ${amount(0)} to ${amount(regression.headMedian)}; ` +
        `a +${regression.thresholdPct}% budget allows no increase from a zero baseline (percentage change unavailable)`,
    };
  }
  let delta = regression.deltaPct;
  let threshold = regression.thresholdPct;
  for (let decimals = 0; decimals <= 15; decimals += 1) {
    const roundedDelta = Number(regression.deltaPct.toFixed(decimals));
    const roundedThreshold = Number(regression.thresholdPct.toFixed(decimals));
    if (roundedDelta > roundedThreshold) {
      delta = roundedDelta;
      threshold = roundedThreshold;
      break;
    }
  }
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}%`;
  return {
    labels,
    delta: signed(delta),
    threshold: signed(threshold),
    text: `delta ${signed(delta)} exceeds ${signed(threshold)} threshold`,
  };
}
