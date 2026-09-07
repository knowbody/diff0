import { median, round, sequencesEqual } from "../numeric.js";
import type { RunRecord } from "../types.js";
import { EVAL_ALPHA, SOFT_SCORE_REGRESSION_THRESHOLD } from "./constants.js";
import { fisherExactDirectional, formatP, holmAdjusted, twoProportionHint } from "./statistics.js";
import type { EvalDelta, EvalStatisticalEvidence, EvalStatus } from "./types.js";

interface RefEvalAgg {
  passed: number;
  total: number;
  /** Numeric scorer values keyed by check identity for each run that reported the eval. */
  softRunChecks: Array<Map<string, number>>;
}

function namedScores(result: RunRecord["evalResults"][number]): Map<string, number> {
  const scores = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const check of result.checks) {
    if (typeof check.score !== "number") continue;
    const occurrence = (occurrences.get(check.name) ?? 0) + 1;
    occurrences.set(check.name, occurrence);
    scores.set(`${check.name}\u0000${occurrence}`, check.score);
  }
  return scores;
}

export function collectScoreComparabilityMismatches(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  mismatches: string[],
): void {
  const evalNames = new Set(
    [...baseRuns, ...headRuns].flatMap((run) =>
      run.evalResults.filter((result) => namedScores(result).size > 0).map((result) => result.name),
    ),
  );
  for (const evalName of [...evalNames].sort()) {
    const scoreSets = (runs: RunRecord[]) =>
      runs.map((run) => {
        const result = run.evalResults.find((candidate) => candidate.name === evalName);
        return result ? new Set(namedScores(result).keys()) : new Set<string>();
      });
    const baseSets = scoreSets(baseRuns);
    const headSets = scoreSets(headRuns);
    const baseNames = [...new Set(baseSets.flatMap((set) => [...set]))].sort();
    const headNames = [...new Set(headSets.flatMap((set) => [...set]))].sort();
    if (!sequencesEqual(baseNames, headNames)) {
      mismatches.push(`scored check set differs for eval ${JSON.stringify(evalName)} between refs`);
      continue;
    }
    const incomplete = baseNames.some(
      (name) => !baseSets.every((set) => set.has(name)) || !headSets.every((set) => set.has(name)),
    );
    if (incomplete) {
      mismatches.push(
        `scored check coverage is incomplete for eval ${JSON.stringify(evalName)} across runs`,
      );
    }
  }
}

function aggregateEvals(runs: RunRecord[]): Map<string, RefEvalAgg> {
  const byName = new Map<string, RefEvalAgg>();
  for (const run of runs) {
    const seen = new Set<string>();
    for (const result of run.evalResults) {
      if (seen.has(result.name)) {
        throw new Error(
          `computeDelta: duplicate eval result ${JSON.stringify(result.name)} in ` +
            `${run.ref} runIndex ${run.runIndex}`,
        );
      }
      seen.add(result.name);
      let agg = byName.get(result.name);
      if (!agg) {
        agg = { passed: 0, total: 0, softRunChecks: [] };
        byName.set(result.name, agg);
      }
      agg.total += 1;
      if (result.passed) agg.passed += 1;
      const scoredChecks = namedScores(result);
      if (scoredChecks.size > 0) agg.softRunChecks.push(scoredChecks);
    }
  }
  return byName;
}

function evalStatus(
  basePassed: number,
  baseTotal: number,
  baseExpectedRuns: number,
  headPassed: number,
  headTotal: number,
  headExpectedRuns: number,
): {
  status: EvalStatus;
  evidence: EvalStatisticalEvidence;
  rawPValue: number | null;
  direction: "regression" | "improvement" | null;
} {
  const evidenceBase = {
    method: "one-sided-fisher-exact" as const,
    correction: "holm" as const,
    comparisons: 0,
    alpha: EVAL_ALPHA,
  };
  if (baseTotal === 0) {
    return {
      status: "missing-base",
      rawPValue: null,
      direction: null,
      evidence: {
        ...evidenceBase,
        classification: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        note: "eval is absent on base; no like-for-like statistical comparison is possible",
      },
    };
  }
  if (headTotal === 0) {
    return {
      status: "missing-head",
      rawPValue: null,
      direction: null,
      evidence: {
        ...evidenceBase,
        classification: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        note: "eval is absent on head; coverage removal requires review",
      },
    };
  }
  const partialBase = baseTotal < baseExpectedRuns;
  const partialHead = headTotal < headExpectedRuns;
  if (partialBase || partialHead) {
    const status: EvalStatus =
      partialBase && partialHead ? "partial-both" : partialBase ? "partial-base" : "partial-head";
    const scopes = [
      ...(partialBase ? [`base ${baseTotal}/${baseExpectedRuns} runs`] : []),
      ...(partialHead ? [`head ${headTotal}/${headExpectedRuns} runs`] : []),
    ];
    return {
      status,
      rawPValue: null,
      direction: null,
      evidence: {
        ...evidenceBase,
        classification: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        note: `eval coverage is incomplete (${scopes.join(", ")}); no like-for-like statistical comparison is possible`,
      },
    };
  }
  const baseRate = basePassed / baseTotal;
  const headRate = headPassed / headTotal;
  const baseFlaky = basePassed > 0 && basePassed < baseTotal;
  const headFlaky = headPassed > 0 && headPassed < headTotal;
  if (baseRate !== headRate) {
    const pValue = fisherExactDirectional(basePassed, baseTotal, headPassed, headTotal);
    const direction = baseRate > headRate ? "regression" : "improvement";
    return {
      status: direction === "regression" ? "inconclusive-regression" : "inconclusive-improvement",
      rawPValue: pValue,
      direction,
      evidence: {
        ...evidenceBase,
        classification: "inconclusive",
        pValue: null,
        adjustedPValue: null,
        note: `provisional ${direction}: one-sided Fisher exact raw p=${formatP(pValue)}`,
      },
    };
  }
  const status: EvalStatus =
    baseFlaky && headFlaky
      ? "flaky-both"
      : baseFlaky
        ? "flaky-base"
        : headFlaky
          ? "flaky-head"
          : basePassed === baseTotal
            ? "pass"
            : "fail";
  return {
    status,
    // Equal outcomes are still a member of the predetermined family. Their
    // hypothesis contributes p=1 without cluttering the rendered row.
    rawPValue: 1,
    direction: null,
    evidence: {
      ...evidenceBase,
      classification: "equivalent",
      pValue: null,
      adjustedPValue: null,
      note: "observed pass proportions are equal",
    },
  };
}

const STATUS_SEVERITY: Record<EvalStatus, number> = {
  regressed: 0,
  "missing-head": 1,
  "partial-head": 2,
  "partial-both": 3,
  "partial-base": 4,
  "inconclusive-regression": 5,
  "flaky-both": 6,
  "flaky-head": 7,
  "flaky-base": 8,
  fail: 9,
  "missing-base": 10,
  "inconclusive-improvement": 11,
  improved: 12,
  pass: 13,
};

export function computeEvalDeltas(baseRuns: RunRecord[], headRuns: RunRecord[]): EvalDelta[] {
  const baseAgg = aggregateEvals(baseRuns);
  const headAgg = aggregateEvals(headRuns);
  const names = [...new Set([...baseAgg.keys(), ...headAgg.keys()])];

  const analyses = names.map((name) => {
    const b = baseAgg.get(name) ?? { passed: 0, total: 0, softRunChecks: [] };
    const h = headAgg.get(name) ?? { passed: 0, total: 0, softRunChecks: [] };
    const { status, evidence, rawPValue, direction } = evalStatus(
      b.passed,
      b.total,
      baseRuns.length,
      h.passed,
      h.total,
      headRuns.length,
    );

    const delta: EvalDelta = {
      name,
      basePassed: b.passed,
      baseTotal: b.total,
      baseExpectedRuns: baseRuns.length,
      headPassed: h.passed,
      headTotal: h.total,
      headExpectedRuns: headRuns.length,
      status,
      statisticalEvidence: evidence,
    };

    const allScoredRuns = [...b.softRunChecks, ...h.softRunChecks];
    const firstScoredRun = allScoredRuns[0];
    const commonScorers =
      firstScoredRun !== undefined
        ? [...firstScoredRun.keys()].filter((checkName) =>
            allScoredRuns.every((checks) => checks.has(checkName)),
          )
        : [];
    if (
      commonScorers.length > 0 &&
      b.softRunChecks.length === baseRuns.length &&
      h.softRunChecks.length === headRuns.length
    ) {
      const perRunMean = (checks: Map<string, number>) =>
        commonScorers.reduce((sum, checkName) => sum + (checks.get(checkName) as number), 0) /
        commonScorers.length;
      const rawBaseMedian = median(b.softRunChecks.map(perRunMean));
      const rawHeadMedian = median(h.softRunChecks.map(perRunMean));
      const rawDelta = rawHeadMedian - rawBaseMedian;
      const classification =
        rawDelta <= -SOFT_SCORE_REGRESSION_THRESHOLD + 1e-12
          ? "material-regression"
          : rawDelta >= SOFT_SCORE_REGRESSION_THRESHOLD - 1e-12
            ? "material-improvement"
            : "within-threshold";
      delta.softScores = {
        baseMedian: round(rawBaseMedian, 4),
        headMedian: round(rawHeadMedian, 4),
        delta: round(rawDelta, 4),
        materialThreshold: SOFT_SCORE_REGRESSION_THRESHOLD,
        classification,
      };
    }

    // Hint only for complete, internally consistent refs whose proportions differ.
    const bothPresent = b.total === baseRuns.length && h.total === headRuns.length;
    const bothConsistent =
      bothPresent &&
      (b.passed === 0 || b.passed === b.total) &&
      (h.passed === 0 || h.passed === h.total);
    const proportionsDiffer = bothPresent && b.passed * h.total !== h.passed * b.total;
    if (bothConsistent && proportionsDiffer) {
      const hint = twoProportionHint(b.passed, b.total, h.passed, h.total);
      if (hint) delta.twoProportionHint = hint;
    }

    return { delta, rawPValue, direction };
  });

  // The family is fixed before inspecting which evals changed: every eval with
  // complete observations on both refs contributes a hypothesis (equal rates
  // contribute p=1). Selecting only observed changes would invalidate Holm's
  // family-wise error guarantee.
  const compared = analyses.filter(
    (analysis): analysis is typeof analysis & { rawPValue: number } => analysis.rawPValue !== null,
  );
  const adjusted = holmAdjusted(compared.map((analysis) => analysis.rawPValue));
  for (const analysis of analyses) {
    analysis.delta.statisticalEvidence.comparisons = compared.length;
  }
  compared.forEach((analysis, index) => {
    const { delta, rawPValue, direction } = analysis;
    // Equal rates participate in the family as p=1 but remain visually quiet.
    if (direction === null) return;
    const adjustedPValue = adjusted[index] as number;
    const significant = adjustedPValue <= EVAL_ALPHA + 1e-12;
    delta.status = significant
      ? direction === "regression"
        ? "regressed"
        : "improved"
      : direction === "regression"
        ? "inconclusive-regression"
        : "inconclusive-improvement";
    delta.statisticalEvidence = {
      ...delta.statisticalEvidence,
      classification: significant
        ? direction === "regression"
          ? "regressed"
          : "improved"
        : "inconclusive",
      pValue: round(rawPValue, 6),
      adjustedPValue: round(adjustedPValue, 6),
      comparisons: compared.length,
      note: significant
        ? `statistically confirmed ${direction}: one-sided Fisher exact raw p=${formatP(
            rawPValue,
          )}, Holm-adjusted p=${formatP(adjustedPValue)} <= ${EVAL_ALPHA}`
        : `observed ${direction} is inconclusive: one-sided Fisher exact raw p=${formatP(
            rawPValue,
          )}, Holm-adjusted p=${formatP(adjustedPValue)} > ${EVAL_ALPHA}`,
    };
  });

  return analyses
    .map((analysis) => analysis.delta)
    .sort((a, b) => {
      const bySeverity = STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status];
      if (bySeverity !== 0) return bySeverity;
      return a.name.localeCompare(b.name);
    });
}
