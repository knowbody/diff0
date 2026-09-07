import {
  ENFORCEMENT_CATEGORIES,
  OPERATIONAL_REGRESSION_MIN_RUNS,
  RECOMMENDED_RUNS,
  SOFT_SCORE_REGRESSION_THRESHOLD,
} from "./constants.js";
import { formatP } from "./statistics.js";
import type {
  CostPerf,
  DriftSection,
  EnforcementCategory,
  EnforcementClassification,
  EvalDelta,
  EvalStatus,
  PerformanceMetric,
  PerformanceRegression,
  Verdict,
} from "./types.js";

function runsPhrase(baseN: number, headN: number): string {
  const noun = (n: number) => (n === 1 ? "run" : "runs");
  return baseN === headN
    ? `${baseN} ${noun(baseN)} per ref`
    : `${baseN} base ${noun(baseN)} / ${headN} head ${noun(headN)}`;
}

/**
 * A complete, repeated all-pass -> all-fail collapse is operationally unsafe even when
 * a large Holm family leaves its statistical classification inconclusive. This affects
 * only the top-level release gate; the eval row keeps its Fisher/Holm evidence unchanged.
 */
function isOperationalRegression(evalDelta: EvalDelta): boolean {
  return (
    evalDelta.baseTotal === evalDelta.baseExpectedRuns &&
    evalDelta.headTotal === evalDelta.headExpectedRuns &&
    evalDelta.baseTotal >= OPERATIONAL_REGRESSION_MIN_RUNS &&
    evalDelta.headTotal >= OPERATIONAL_REGRESSION_MIN_RUNS &&
    evalDelta.basePassed === evalDelta.baseTotal &&
    evalDelta.headPassed === 0
  );
}

const PERFORMANCE_LABELS: Record<PerformanceMetric, string> = {
  costUsd: "cost/session",
  tokensIn: "input tokens/session",
  tokensOut: "output tokens/session",
  durationMs: "duration/session",
};

function performanceRegressionReason(regression: PerformanceRegression): string {
  if (regression.deltaPct === null) {
    return (
      `${PERFORMANCE_LABELS[regression.metric]} performance regression: median increased from zero to ${regression.headMedian}; ` +
      `a ${regression.thresholdPct}% budget allows no increase from a zero baseline (percentage change unavailable)`
    );
  }
  const sign = regression.deltaPct >= 0 ? "+" : "";
  return (
    `${PERFORMANCE_LABELS[regression.metric]} performance regression: median increased ${sign}` +
    `${regression.deltaPct}% (threshold ${regression.thresholdPct}%; ` +
    `base ${regression.baseMedian}, head ${regression.headMedian})`
  );
}

export function classifyEnforcement(
  evals: EvalDelta[],
  drift: DriftSection,
  costPerf: CostPerf,
  mismatches: string[],
): EnforcementClassification {
  const reasons = new Map<EnforcementCategory, string[]>();
  const add = (category: EnforcementCategory, reason: string) => {
    const current = reasons.get(category) ?? [];
    current.push(reason);
    reasons.set(category, current);
  };

  for (const evalDelta of evals) {
    if (evalDelta.status === "regressed" || isOperationalRegression(evalDelta)) {
      add(
        "eval-regression",
        `${evalDelta.name}: passed ${evalDelta.basePassed}/${evalDelta.baseTotal} on base, ` +
          `${evalDelta.headPassed}/${evalDelta.headTotal} on head`,
      );
    }
    if (evalDelta.softScores?.classification === "material-regression") {
      add(
        "score-regression",
        `${evalDelta.name}: median score ${evalDelta.softScores.baseMedian} on base vs ` +
          `${evalDelta.softScores.headMedian} on head`,
      );
    }
  }
  for (const regression of costPerf.regressions) {
    add("performance-regression", performanceRegressionReason(regression));
  }
  if (drift.hasDrift) add("behavioral-drift", "behavioral drift detected");
  for (const mismatch of mismatches) add("comparison-validity", mismatch);
  if (hasOutputCaptureGap(drift)) {
    add(
      "comparison-validity",
      "Final-output capture is incomplete; absence was not explicitly reported.",
    );
  }
  if ((costPerf.costUsd.base === null) !== (costPerf.costUsd.head === null)) {
    add(
      "comparison-validity",
      "cost comparability unavailable: one ref has complete non-zero cost data and the other does not",
    );
  }

  return {
    violations: ENFORCEMENT_CATEGORIES.flatMap((category) => {
      const categoryReasons = reasons.get(category);
      return categoryReasons ? [{ category, reasons: categoryReasons }] : [];
    }),
  };
}

function hasOutputCaptureGap(drift: DriftSection): boolean {
  return drift.finalOutputs.some(
    (output) =>
      output.baseCapturedRuns + (output.baseAbsentRuns ?? 0) < output.baseTotalRuns ||
      output.headCapturedRuns + (output.headAbsentRuns ?? 0) < output.headTotalRuns,
  );
}

export function computeVerdict(
  evals: EvalDelta[],
  drift: DriftSection,
  costPerf: CostPerf,
  baseN: number,
  headN: number,
  mismatches: string[],
): { verdict: Verdict; verdictSummary: string; verdictReasons: string[] } {
  const reasons: string[] = [];
  const outputCaptureGap = hasOutputCaptureGap(drift);
  if (outputCaptureGap)
    reasons.push("Final-output capture is incomplete; absence was not explicitly reported.");

  for (const mismatch of mismatches) reasons.push(`comparison validity: ${mismatch}`);

  const regressed = evals.filter((e) => e.status === "regressed");
  for (const e of regressed) {
    reasons.push(
      `${e.name} regressed: passed ${e.basePassed}/${e.baseTotal} on base, ` +
        `${e.headPassed}/${e.headTotal} on head (${e.statisticalEvidence.note})`,
    );
  }

  const operationalRegressions = evals.filter(
    (e) => e.status !== "regressed" && isOperationalRegression(e),
  );
  for (const e of operationalRegressions) {
    reasons.push(
      `${e.name} operational regression: passed ${e.basePassed}/${e.baseTotal} on base, ` +
        `${e.headPassed}/${e.headTotal} on head; complete all-pass to all-fail collapse across ` +
        `at least ${OPERATIONAL_REGRESSION_MIN_RUNS} runs per ref ` +
        `(statistical classification remains ${e.statisticalEvidence.classification}; ` +
        `${e.statisticalEvidence.note})`,
    );
  }

  const inconclusive = evals.filter(
    (e) => e.status === "inconclusive-regression" || e.status === "inconclusive-improvement",
  );
  const otherInconclusive = inconclusive.filter((e) => !operationalRegressions.includes(e));
  for (const e of otherInconclusive) {
    reasons.push(
      `${e.name}: passed ${e.basePassed}/${e.baseTotal} on base, ` +
        `${e.headPassed}/${e.headTotal} on head — ${e.statisticalEvidence.note}`,
    );
  }

  const removed = evals.filter((e) => e.status === "missing-head");
  for (const e of removed) reasons.push(`eval coverage removed on head: ${e.name}`);
  const added = evals.filter((e) => e.status === "missing-base");
  for (const e of added) reasons.push(`eval coverage added on head: ${e.name}`);
  const partial = evals.filter(
    (e) =>
      e.status === "partial-base" || e.status === "partial-head" || e.status === "partial-both",
  );
  for (const e of partial) {
    reasons.push(
      `eval coverage incomplete for ${e.name}: observed ${e.baseTotal}/${e.baseExpectedRuns} base runs ` +
        `and ${e.headTotal}/${e.headExpectedRuns} head runs`,
    );
  }

  const materialScoreRegressions = evals.filter(
    (e) => e.softScores?.classification === "material-regression",
  );
  for (const e of materialScoreRegressions) {
    const score = e.softScores as NonNullable<EvalDelta["softScores"]>;
    reasons.push(
      `${e.name} material score regression: median ${score.baseMedian} on base vs ` +
        `${score.headMedian} on head (${score.delta}; review threshold -${score.materialThreshold})`,
    );
  }

  const flaky = evals.filter(
    (e) => e.status === "flaky-base" || e.status === "flaky-head" || e.status === "flaky-both",
  );
  for (const e of flaky) {
    const where =
      e.status === "flaky-both" ? "both refs" : e.status === "flaky-base" ? "base" : "head";
    reasons.push(
      `${e.name} is flaky (inconsistent within ${where}): passed ` +
        `${e.basePassed}/${e.baseTotal} on base, ${e.headPassed}/${e.headTotal} on head — ` +
        "equal observed proportions, but within-ref outcomes are unstable",
    );
  }
  const flakySuffix =
    flaky.length > 0
      ? ` — ${flaky.length} eval${flaky.length === 1 ? "" : "s"} flaky within a ref`
      : "";

  for (const s of drift.skills) {
    if (s.confidence === "inconclusive") continue;
    reasons.push(
      `skill ${s.confidence === "statistically-confirmed" ? "drift" : "change (inconclusive)"}: ` +
        `${s.name} loaded in ${s.baseLoadedRuns} of ${s.baseTotalRuns} base runs vs ` +
        `${s.headLoadedRuns} of ${s.headTotalRuns} head runs (two-sided Fisher raw p=${formatP(
          s.pValue,
        )}, Holm-adjusted p=${formatP(s.adjustedPValue)})`,
    );
  }
  for (const sequence of drift.toolSequences) {
    const scope = sequence.evalName ? ` in eval ${sequence.evalName}` : " (unattributed)";
    if (sequence.divergenceNote !== null && sequence.divergenceConfidence === "stable") {
      reasons.push(`tool sequence change${scope}: ${sequence.divergenceNote}`);
    }
    for (const t of sequence.callCountDeltas) {
      if (t.confidence === "inconclusive") continue;
      reasons.push(
        `tool ${t.confidence === "stable" ? "drift" : "change (inconclusive)"}${scope}: ` +
          `${t.name} median calls/run ${t.baseMedianCalls} on base vs ` +
          `${t.headMedianCalls} on head`,
      );
    }
  }
  for (const s of drift.subagents) {
    if (s.confidence === "inconclusive") continue;
    reasons.push(
      `subagent ${s.confidence === "statistically-confirmed" ? "drift" : "change (inconclusive)"}: ` +
        `${s.name} used in ${s.baseUsedRuns} of ${s.baseTotalRuns} base runs vs ` +
        `${s.headUsedRuns} of ${s.headTotalRuns} head runs (two-sided Fisher raw p=${formatP(
          s.pValue,
        )}, Holm-adjusted p=${formatP(s.adjustedPValue)})`,
    );
  }
  for (const input of drift.toolInputs) {
    if (input.confidence === "inconclusive") continue;
    const scope = input.evalName ? ` in eval ${input.evalName}` : "";
    reasons.push(
      `tool input ${input.confidence === "stable" ? "drift" : "change (inconclusive)"}: ` +
        `${input.toolName} call ${input.occurrence}${scope} used different input fingerprints`,
    );
  }
  for (const output of drift.finalOutputs) {
    if (output.confidence === "inconclusive") continue;
    const scope = output.evalName ? ` in eval ${output.evalName}` : " (unattributed)";
    const incompleteCapture =
      output.baseCapturedRuns !== output.baseTotalRuns ||
      output.headCapturedRuns !== output.headTotalRuns;
    reasons.push(
      `final output ${output.confidence === "stable" ? "drift" : "change (inconclusive)"}${scope}: ` +
        (incompleteCapture
          ? `capture available in ${output.baseCapturedRuns}/${output.baseTotalRuns} base runs and ` +
            `${output.headCapturedRuns}/${output.headTotalRuns} head runs`
          : "privacy-preserving output fingerprints differ between refs"),
    );
  }

  const performanceRegressions = costPerf.regressions;
  const hasPerformanceRegression = performanceRegressions.length > 0;
  const costAvailabilityMismatch =
    (costPerf.costUsd.base === null) !== (costPerf.costUsd.head === null);
  for (const regression of performanceRegressions) {
    reasons.push(performanceRegressionReason(regression));
  }
  if (costAvailabilityMismatch) {
    reasons.push(
      "cost comparability unavailable: one ref has complete non-zero cost data and the other does not",
    );
  }

  const phrase = runsPhrase(baseN, headN);
  if ((regressed.length > 0 || operationalRegressions.length > 0) && mismatches.length === 0) {
    const gatedRegressions = [...regressed, ...operationalRegressions];
    const names = gatedRegressions.map((e) => e.name).join(", ");
    const summaryPrefix =
      operationalRegressions.length === 0
        ? `${regressed.length} eval${regressed.length === 1 ? "" : "s"} regressed`
        : regressed.length === 0
          ? `${operationalRegressions.length} operational eval regression${operationalRegressions.length === 1 ? "" : "s"}`
          : `${gatedRegressions.length} eval regressions (${regressed.length} statistically confirmed, ` +
            `${operationalRegressions.length} operational)`;
    return {
      verdict: "red",
      verdictSummary: `${summaryPrefix} across ${phrase}: ${names}`,
      verdictReasons: reasons,
    };
  }
  const reviewEvals = [...otherInconclusive, ...removed, ...added, ...partial, ...flaky];
  if (
    drift.hasDrift ||
    outputCaptureGap ||
    hasPerformanceRegression ||
    costAvailabilityMismatch ||
    mismatches.length > 0 ||
    reviewEvals.length > 0 ||
    materialScoreRegressions.length > 0
  ) {
    const summaryParts: string[] = [];
    if (outputCaptureGap) summaryParts.push("final-output capture incomplete");
    if (removed.length > 0)
      summaryParts.push(`${removed.length} eval${removed.length === 1 ? "" : "s"} removed`);
    if (added.length > 0)
      summaryParts.push(`${added.length} eval${added.length === 1 ? "" : "s"} added`);
    if (partial.length > 0)
      summaryParts.push(`${partial.length} eval${partial.length === 1 ? "" : "s"} incomplete`);
    if (otherInconclusive.length > 0)
      summaryParts.push(
        `${otherInconclusive.length} eval change${otherInconclusive.length === 1 ? "" : "s"} inconclusive`,
      );
    if (flaky.length > 0)
      summaryParts.push(`${flaky.length} flaky eval${flaky.length === 1 ? "" : "s"}`);
    if (materialScoreRegressions.length > 0) {
      summaryParts.push(
        `${materialScoreRegressions.length} material score regression${materialScoreRegressions.length === 1 ? "" : "s"}`,
      );
    }
    if (regressed.length > 0) {
      summaryParts.push(
        `${regressed.length} apparent eval regression${regressed.length === 1 ? "" : "s"} confounded by comparison validity`,
      );
    }
    if (operationalRegressions.length > 0) {
      summaryParts.push(
        `${operationalRegressions.length} operational eval regression${operationalRegressions.length === 1 ? "" : "s"} confounded by comparison validity`,
      );
    }
    if (drift.hasDrift) summaryParts.push("behavioral drift detected");
    if (hasPerformanceRegression) {
      summaryParts.push(
        `${performanceRegressions.length} performance regression${performanceRegressions.length === 1 ? "" : "s"}`,
      );
    }
    if (costAvailabilityMismatch) summaryParts.push("cost comparability unavailable");
    if (mismatches.length > 0) summaryParts.push("comparison validity warnings");
    return {
      verdict: "yellow",
      verdictSummary: `No confirmed eval regressions across ${phrase} — ${summaryParts.join(", ")}`,
      verdictReasons: reasons,
    };
  }
  return {
    verdict: "green",
    verdictSummary: drift.hasInconclusive
      ? `No regressions or supported behavioral drift detected across ${phrase}; inconclusive observations retained in details`
      : `No regressions or behavioral drift detected across ${phrase}${flakySuffix}`,
    verdictReasons:
      reasons.length > 0 ? reasons : ["no regressions or supported behavioral drift detected"],
  };
}

const BORDERLINE_STATUSES: ReadonlySet<EvalStatus> = new Set([
  "regressed",
  "improved",
  "flaky-base",
  "flaky-head",
  "flaky-both",
  "inconclusive-regression",
  "inconclusive-improvement",
]);

export function computeCaveats(
  evals: EvalDelta[],
  baseN: number,
  headN: number,
  flakinessDetectable: boolean,
  baseCacheHit: boolean,
): string[] {
  const caveats: string[] = [];
  if (baseCacheHit) {
    caveats.push(
      "Base results were reused from the opt-in cache and may predate the head runs by up to 24 hours; " +
        "environment variables and external service state are not part of the cache key. Re-run without " +
        "--cache before treating the result as a release gate.",
    );
  }
  if (!flakinessDetectable) {
    const single =
      baseN === 1 && headN === 1 ? "each ref" : baseN === 1 ? "the base ref" : "the head ref";
    caveats.push(
      `Only 1 run on ${single} — flakiness within a ref cannot be detected, so a single ` +
        "pass/fail flip may be noise rather than a real change. Use --runs 3 or more.",
    );
  }
  const borderline = evals.some((e) => BORDERLINE_STATUSES.has(e.status));
  if (borderline && Math.min(baseN, headN) < RECOMMENDED_RUNS) {
    caveats.push(
      `Borderline results at N=${Math.min(baseN, headN)} — consider --runs ${RECOMMENDED_RUNS} ` +
        "or more for a clearer signal.",
    );
  }
  if (evals.some((e) => e.softScores?.classification === "material-regression")) {
    caveats.push(
      `Material soft-score regressions use an absolute median-delta review threshold ` +
        `(${SOFT_SCORE_REGRESSION_THRESHOLD}), not a hypothesis test; inspect the scorer evidence ` +
        "before treating the change as causal.",
    );
  }
  caveats.push(
    "External side effects (for example writes to third-party systems) are not observed; " +
      "the comparison covers captured eval JSON/events, fingerprints, cost, and timing only.",
  );
  return caveats;
}
