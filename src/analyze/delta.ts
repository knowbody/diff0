/**
 * computeDelta: RunRecord[] x2 -> DeltaReport.
 *
 * Pure and deterministic (inject `now` for reproducible output), no I/O.
 * All honest-framing decisions live here so renderers stay dumb:
 * - confirmed regressions require directional Fisher-exact evidence;
 * - one narrow all-pass -> all-fail operational rule can fail the release gate while
 *   leaving underpowered statistical evidence explicitly inconclusive;
 * - missing cost data is reported unavailable, never $0.
 */
import type { RunRecord } from "../types.js";
import type {
  ComparisonMeta,
  CostPerf,
  CostSource,
  DataSourcesSummary,
  DeltaReport,
  DriftSection,
  EnforcementCategory,
  EnforcementClassification,
  EvalDelta,
  EvalStatisticalEvidence,
  EvalStatus,
  FinalOutputDelta,
  GitDiffStat,
  MetricDelta,
  MetricStats,
  PerformanceMetric,
  PerformanceRegression,
  PerformanceThresholds,
  RefMeta,
  RunSummary,
  SkillDrift,
  SourcePresence,
  SubagentDrift,
  ToolCountDelta,
  ToolInputDelta,
  ToolSequenceDrift,
  Verdict,
} from "./types.js";

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

export interface ComputeDeltaOptions {
  /** How per-run costUsd was derived. Defaults to "gateway" when costs exist, "unavailable" otherwise. */
  costSource?: "gateway" | "priced-tokens";
  /** Whether RunRecord sandbox labels are inferred; the CLI passes false and records actual as unknown. */
  sandboxInferred?: boolean;
  /** Host capability probe only; kept separate from the unobservable actual sandbox. */
  hostDefaultSandboxCandidate?: RunRecord["sandboxBackend"];
  /** git diff --stat between the refs, supplied by the caller (the analysis layer does no I/O). */
  gitDiffStat?: GitDiffStat | null;
  /** ISO 8601 timestamp override for deterministic output (tests, snapshots). */
  now?: string;
  /** True when base records came from the opt-in cache rather than this comparison window. */
  baseCacheHit?: boolean;
  /** Preflight findings that make the two refs unsuitable for a red/green comparison. */
  validityMismatches?: string[];
  /** Override one or more built-in, increase-only median percentage budgets. */
  performanceThresholds?: Partial<PerformanceThresholds>;
}

export function computeDelta(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  opts: ComputeDeltaOptions = {},
): DeltaReport {
  if (baseRuns.length === 0) {
    throw new Error(
      "computeDelta: baseRuns is empty — at least one completed base run is required. " +
        "Did every base-ref eval run fail to produce a RunRecord?",
    );
  }
  if (headRuns.length === 0) {
    throw new Error(
      "computeDelta: headRuns is empty — at least one completed head run is required. " +
        "Did every head-ref eval run fail to produce a RunRecord?",
    );
  }

  const mismatches: string[] = [...(opts.validityMismatches ?? [])];
  const base = buildRefMeta("base", baseRuns, opts.sandboxInferred ?? true, mismatches);
  const head = buildRefMeta("head", headRuns, opts.sandboxInferred ?? true, mismatches);
  collectCrossRefMismatches(base, head, mismatches);
  collectScoreComparabilityMismatches(baseRuns, headRuns, mismatches);

  const { total: totalComparisonCostUsd, source: costSource } = totalCost(
    baseRuns,
    headRuns,
    opts.costSource,
  );

  const meta: ComparisonMeta = {
    base,
    head,
    runsPerRef: baseRuns.length,
    totalComparisonCostUsd,
    costSource,
    dataSources: summarizeDataSources([...baseRuns, ...headRuns]),
    ...(opts.hostDefaultSandboxCandidate !== undefined
      ? { hostDefaultSandboxCandidate: opts.hostDefaultSandboxCandidate }
      : {}),
    generatedAt: opts.now ?? new Date().toISOString(),
    mismatches,
    gitDiffStat: opts.gitDiffStat ?? null,
  };

  const evals = computeEvalDeltas(baseRuns, headRuns);
  const drift = computeDrift(baseRuns, headRuns);
  const costPerf = computeCostPerf(baseRuns, headRuns, opts.performanceThresholds);

  const { verdict, verdictSummary, verdictReasons } = computeVerdict(
    evals,
    drift,
    costPerf,
    baseRuns.length,
    headRuns.length,
    mismatches,
  );

  const flakinessDetectable = baseRuns.length >= 2 && headRuns.length >= 2;
  const caveats = computeCaveats(
    evals,
    baseRuns.length,
    headRuns.length,
    flakinessDetectable,
    opts.baseCacheHit ?? false,
  );
  const enforcement = classifyEnforcement(evals, drift, costPerf, mismatches);

  return {
    meta,
    verdict,
    verdictSummary,
    verdictReasons,
    evals,
    drift,
    costPerf,
    enforcement,
    caveats,
    flakinessDetectable,
    runSummaries: {
      base: baseRuns.map(summarizeRun),
      head: headRuns.map(summarizeRun),
    },
  };
}

// ---------------------------------------------------------------------------
// Meta

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function foldRefValue(
  side: "base" | "head",
  label: string,
  values: string[],
  mismatches: string[],
): string {
  const uniq = distinct(values);
  if (uniq.length > 1) {
    mismatches.push(`${label} inconsistent within ${side} runs: ${uniq.join(", ")}`);
  }
  return uniq.join(" / ");
}

function buildRefMeta(
  side: "base" | "head",
  runs: RunRecord[],
  sandboxInferred: boolean,
  mismatches: string[],
): RefMeta {
  return {
    ref: foldRefValue(
      side,
      "ref",
      runs.map((r) => r.ref),
      mismatches,
    ),
    commitSha: foldRefValue(
      side,
      "commit",
      runs.map((r) => r.commitSha),
      mismatches,
    ),
    eveVersion: foldRefValue(
      side,
      "eve version",
      runs.map((r) => r.eveVersion),
      mismatches,
    ),
    model: foldRefValue(
      side,
      "model",
      runs.map((r) => r.model),
      mismatches,
    ),
    sandboxBackend: foldRefValue(
      side,
      "sandbox backend",
      runs.map((r) => r.sandboxBackend),
      mismatches,
    ),
    sandboxInferred,
    runs: runs.length,
  };
}

function collectCrossRefMismatches(base: RefMeta, head: RefMeta, mismatches: string[]): void {
  if (base.model !== head.model) {
    mismatches.push(`model differs between refs: base=${base.model}, head=${head.model}`);
  }
  if (base.eveVersion !== head.eveVersion) {
    mismatches.push(
      `eve version differs between refs: base=${base.eveVersion}, head=${head.eveVersion}`,
    );
  }
  if (base.sandboxBackend !== head.sandboxBackend) {
    mismatches.push(
      `sandbox backend differs between refs: base=${base.sandboxBackend}, head=${head.sandboxBackend}`,
    );
  }
  if (base.runs !== head.runs) {
    mismatches.push(`run counts differ between refs: base=${base.runs}, head=${head.runs}`);
  }
}

function summarizeDataSources(runs: RunRecord[]): DataSourcesSummary {
  const presence = (pick: (r: RunRecord) => boolean): SourcePresence => {
    const count = runs.filter(pick).length;
    if (count === 0) return "none";
    if (count === runs.length) return "all";
    return "partial";
  };
  return {
    evalJson: presence((r) => r.dataSources.evalJson),
    spans: presence((r) => r.dataSources.spans),
    logs: presence((r) => r.dataSources.logs),
  };
}

function totalCost(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  declaredSource: "gateway" | "priced-tokens" | undefined,
): { total: number | null; source: CostSource } {
  const costs = [...baseRuns, ...headRuns].map((r) => r.costUsd);
  const allKnown = costs.every((c): c is number => c !== null);
  if (!allKnown) return { total: null, source: "unavailable" };
  // A normalized zero means no trustworthy cost source fed that run. Mixing
  // zero with priced runs must not masquerade as a complete comparison total.
  if (costs.some((cost) => cost === 0)) return { total: null, source: "unavailable" };
  const sum = costs.reduce((acc, c) => acc + c, 0);
  // All-zero cost means no real cost source fed these runs (e.g. mock models);
  // reporting $0.00 would be false precision.
  if (sum === 0) return { total: null, source: "unavailable" };
  return { total: sum, source: declaredSource ?? "gateway" };
}

// ---------------------------------------------------------------------------
// Evals

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

function collectScoreComparabilityMismatches(
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
    if (!sameStrings(baseNames, headNames)) {
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

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const m = Math.min(k, n - k);
  let result = 0;
  for (let i = 1; i <= m; i += 1) result += Math.log(n - m + i) - Math.log(i);
  return result;
}

function hypergeometricProbability(
  x: number,
  rowOneTotal: number,
  rowTwoTotal: number,
  successes: number,
): number {
  return Math.exp(
    logChoose(successes, x) +
      logChoose(rowOneTotal + rowTwoTotal - successes, rowOneTotal - x) -
      logChoose(rowOneTotal + rowTwoTotal, rowOneTotal),
  );
}

/** One-sided Fisher exact p-value in the observed effect direction. */
function fisherExactDirectional(
  basePassed: number,
  baseTotal: number,
  headPassed: number,
  headTotal: number,
): number {
  const successes = basePassed + headPassed;
  const min = Math.max(0, baseTotal - (baseTotal + headTotal - successes));
  const max = Math.min(baseTotal, successes);
  const baseRateHigher = basePassed / baseTotal > headPassed / headTotal;
  let p = 0;
  if (baseRateHigher) {
    for (let x = basePassed; x <= max; x += 1) {
      p += hypergeometricProbability(x, baseTotal, headTotal, successes);
    }
  } else {
    for (let x = min; x <= basePassed; x += 1) {
      p += hypergeometricProbability(x, baseTotal, headTotal, successes);
    }
  }
  return Math.min(1, p);
}

function fisherExactTwoSided(
  baseCount: number,
  baseTotal: number,
  headCount: number,
  headTotal: number,
): number {
  const successes = baseCount + headCount;
  const min = Math.max(0, baseTotal - (baseTotal + headTotal - successes));
  const max = Math.min(baseTotal, successes);
  const observed = hypergeometricProbability(baseCount, baseTotal, headTotal, successes);
  let p = 0;
  for (let x = min; x <= max; x += 1) {
    const probability = hypergeometricProbability(x, baseTotal, headTotal, successes);
    if (probability <= observed + 1e-12) p += probability;
  }
  return Math.min(1, p);
}

function formatP(value: number): string {
  return value < 0.0001 ? "<0.0001" : round(value, 4).toString();
}

function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("median: empty input");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] as number) + upper) / 2;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function twoProportionHint(
  basePassed: number,
  baseTotal: number,
  headPassed: number,
  headTotal: number,
): { zScore: number; note: string } | null {
  const pooled = (basePassed + headPassed) / (baseTotal + headTotal);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / baseTotal + 1 / headTotal));
  if (se === 0) return null;
  const z = (basePassed / baseTotal - headPassed / headTotal) / se;
  const zScore = round(z, 2);
  return {
    zScore,
    note:
      `two-proportion z = ${zScore} (${basePassed}/${baseTotal} base vs ${headPassed}/${headTotal} head) — ` +
      "a directional hint only, not statistical significance at this sample size",
  };
}

function computeEvalDeltas(baseRuns: RunRecord[], headRuns: RunRecord[]): EvalDelta[] {
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

/** Holm step-down adjustment, returned in the caller's original order. */
function holmAdjusted(pValues: number[]): number[] {
  const ranked = pValues
    .map((pValue, index) => ({ pValue, index }))
    .sort((a, b) => a.pValue - b.pValue || a.index - b.index);
  const adjusted = new Array<number>(pValues.length);
  let runningMaximum = 0;
  ranked.forEach((entry, rank) => {
    runningMaximum = Math.max(runningMaximum, (pValues.length - rank) * entry.pValue);
    adjusted[entry.index] = Math.min(1, runningMaximum);
  });
  return adjusted;
}

// ---------------------------------------------------------------------------
// Drift

function runsContaining(runs: RunRecord[], pick: (r: RunRecord) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const name of new Set(pick(run))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function proportionDrift(
  baseCounts: Map<string, number>,
  headCounts: Map<string, number>,
  baseN: number,
  headN: number,
): Array<{
  name: string;
  baseRuns: number;
  headRuns: number;
  changed: boolean;
  pValue: number;
}> {
  const names = [...new Set([...baseCounts.keys(), ...headCounts.keys()])].sort();
  const out: Array<{
    name: string;
    baseRuns: number;
    headRuns: number;
    changed: boolean;
    pValue: number;
  }> = [];
  for (const name of names) {
    const b = baseCounts.get(name) ?? 0;
    const h = headCounts.get(name) ?? 0;
    // Compare as fractions (cross-multiplied) so differing N still compares fairly.
    const changed = b * headN !== h * baseN;
    out.push({
      name,
      baseRuns: b,
      headRuns: h,
      changed,
      // Unchanged observations still belong to the predetermined family.
      pValue: changed ? fisherExactTwoSided(b, baseN, h, headN) : 1,
    });
  }
  return out;
}

function scopedRuns(runs: RunRecord[], evalName: string | null): RunRecord[] {
  if (evalName === null) return runs;
  return runs.filter((run) => run.evalResults.some((result) => result.name === evalName));
}

function toolSequence(run: RunRecord, evalName: string | null): string[] {
  return [...run.toolCalls]
    .filter((call) => (call.evalName ?? null) === evalName)
    .sort((a, b) => a.order - b.order)
    .map((call) => call.name);
}

function mostCommonSequence(
  runs: RunRecord[],
  evalName: string | null,
): {
  sequence: string[];
  count: number;
  tied: boolean;
} {
  const counts = new Map<string, { sequence: string[]; count: number; firstSeen: number }>();
  runs.forEach((run, index) => {
    const sequence = toolSequence(run, evalName);
    const key = sequence.join("\u0000");
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { sequence, count: 1, firstSeen: index });
    }
  });
  let best: { sequence: string[]; count: number; firstSeen: number } | null = null;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.firstSeen < best.firstSeen)
    ) {
      best = entry;
    }
  }
  // runs is never empty (computeDelta validates), so best is always set.
  if (!best) return { sequence: [], count: 0, tied: false };
  const tied = [...counts.values()].filter((entry) => entry.count === best?.count).length > 1;
  return { sequence: best.sequence, count: best.count, tied };
}

function toolCallCounts(run: RunRecord, evalName: string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of run.toolCalls) {
    if ((call.evalName ?? null) !== evalName) continue;
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  return counts;
}

function toolCountDeltas(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  evalName: string | null,
): ToolCountDelta[] {
  const perRunBase = baseRuns.map((run) => toolCallCounts(run, evalName));
  const perRunHead = headRuns.map((run) => toolCallCounts(run, evalName));
  const names = new Set<string>();
  for (const counts of [...perRunBase, ...perRunHead]) {
    for (const name of counts.keys()) names.add(name);
  }
  const out: ToolCountDelta[] = [];
  for (const name of [...names].sort()) {
    const baseMedianCalls = median(perRunBase.map((c) => c.get(name) ?? 0));
    const headMedianCalls = median(perRunHead.map((c) => c.get(name) ?? 0));
    if (baseMedianCalls !== headMedianCalls) {
      const baseValues = perRunBase.map((c) => c.get(name) ?? 0);
      const headValues = perRunHead.map((c) => c.get(name) ?? 0);
      const rangesDoNotOverlap =
        Math.max(...baseValues) < Math.min(...headValues) ||
        Math.max(...headValues) < Math.min(...baseValues);
      out.push({
        evalName,
        name,
        baseMedianCalls,
        headMedianCalls,
        confidence:
          baseRuns.length >= 2 && headRuns.length >= 2 && rangesDoNotOverlap
            ? "stable"
            : "inconclusive",
      });
    }
  }
  return out;
}

function alignedToolInputs(runs: RunRecord[]): Map<string, Array<string | null>> {
  const allKeys = new Set<string>();
  const perRun = runs.map((run) => {
    const observed = new Map<string, string>();
    const occurrences = new Map<string, number>();
    for (const call of [...run.toolCalls].sort((a, b) => a.order - b.order)) {
      const scope = call.evalName ?? "";
      const counterKey = `${scope}\u0000${call.name}`;
      const occurrence = (occurrences.get(counterKey) ?? 0) + 1;
      occurrences.set(counterKey, occurrence);
      const key = `${scope}\u0000${call.name}\u0000${occurrence}`;
      observed.set(key, call.inputsHash);
      allKeys.add(key);
    }
    return observed;
  });
  const result = new Map<string, Array<string | null>>();
  for (const key of allKeys)
    result.set(
      key,
      perRun.map((run) => run.get(key) ?? null),
    );
  return result;
}

function distinctPresent(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}

function fingerprintFrequencies(
  values: Array<string | null>,
): Array<{ hash: string; runs: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([hash, runs]) => ({ hash, runs }));
}

function sameFingerprintDistribution(
  base: Array<{ hash: string; runs: number }>,
  head: Array<{ hash: string; runs: number }>,
): boolean {
  const baseTotal = base.reduce((total, item) => total + item.runs, 0);
  const headTotal = head.reduce((total, item) => total + item.runs, 0);
  if (baseTotal === 0 || headTotal === 0) return false;
  const baseCounts = new Map(base.map((item) => [item.hash, item.runs]));
  const headCounts = new Map(head.map((item) => [item.hash, item.runs]));
  const hashes = new Set([...baseCounts.keys(), ...headCounts.keys()]);
  return [...hashes].every(
    (hash) => (baseCounts.get(hash) ?? 0) * headTotal === (headCounts.get(hash) ?? 0) * baseTotal,
  );
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function toolInputDeltas(baseRuns: RunRecord[], headRuns: RunRecord[]): ToolInputDelta[] {
  const base = alignedToolInputs(baseRuns);
  const head = alignedToolInputs(headRuns);
  const keys = [...new Set([...base.keys(), ...head.keys()])].sort();
  const out: ToolInputDelta[] = [];
  for (const key of keys) {
    const baseValues = base.get(key) ?? baseRuns.map(() => null);
    const headValues = head.get(key) ?? headRuns.map(() => null);
    const baseHashes = distinctPresent(baseValues);
    const headHashes = distinctPresent(headValues);
    const baseFrequencies = fingerprintFrequencies(baseValues);
    const headFrequencies = fingerprintFrequencies(headValues);
    const baseHashRuns = baseFrequencies.reduce((total, item) => total + item.runs, 0);
    const headHashRuns = headFrequencies.reduce((total, item) => total + item.runs, 0);
    // Added/removed calls are already represented by sequence/count drift.
    if (
      baseHashes.length === 0 ||
      headHashes.length === 0 ||
      sameFingerprintDistribution(baseFrequencies, headFrequencies)
    ) {
      continue;
    }
    const [scope = "", toolName = "", occurrenceText = "1"] = key.split("\u0000");
    const stableAndRepeated =
      baseRuns.length >= 2 &&
      headRuns.length >= 2 &&
      baseValues.every((value) => value === baseValues[0] && value !== null) &&
      headValues.every((value) => value === headValues[0] && value !== null);
    out.push({
      evalName: scope === "" ? null : scope,
      toolName,
      occurrence: Number(occurrenceText),
      baseHashes,
      headHashes,
      baseFrequencies,
      headFrequencies,
      baseHashRuns,
      headHashRuns,
      confidence: stableAndRepeated ? "stable" : "inconclusive",
    });
  }
  return out;
}

function finalOutputDelta(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  evalName: string | null,
): FinalOutputDelta | null {
  const fingerprint = (run: RunRecord) =>
    evalName === null
      ? run.finalOutput
      : run.evalResults.find((result) => result.name === evalName)?.finalOutput;
  const baseFingerprints = baseRuns.map(fingerprint).filter((value) => value !== undefined);
  const headFingerprints = headRuns.map(fingerprint).filter((value) => value !== undefined);
  if (baseFingerprints.length === 0 && headFingerprints.length === 0) return null;
  const baseHashes = [...new Set(baseFingerprints.map((value) => value.hash))].sort();
  const headHashes = [...new Set(headFingerprints.map((value) => value.hash))].sort();
  const baseFrequencies = fingerprintFrequencies(baseFingerprints.map((value) => value.hash));
  const headFrequencies = fingerprintFrequencies(headFingerprints.map((value) => value.hash));
  if (
    sameFingerprintDistribution(baseFrequencies, headFrequencies) &&
    baseFingerprints.length === baseRuns.length &&
    headFingerprints.length === headRuns.length
  ) {
    return null;
  }
  const baseLengths = [...new Set(baseFingerprints.flatMap((value) => value.length ?? []))].sort(
    (a, b) => a - b,
  );
  const headLengths = [...new Set(headFingerprints.flatMap((value) => value.length ?? []))].sort(
    (a, b) => a - b,
  );
  const stableAndRepeated =
    baseFingerprints.length === baseRuns.length &&
    headFingerprints.length === headRuns.length &&
    baseRuns.length >= 2 &&
    headRuns.length >= 2 &&
    baseHashes.length === 1 &&
    headHashes.length === 1;
  return {
    evalName,
    baseCapturedRuns: baseFingerprints.length,
    baseTotalRuns: baseRuns.length,
    headCapturedRuns: headFingerprints.length,
    headTotalRuns: headRuns.length,
    baseHashes,
    headHashes,
    baseFrequencies,
    headFrequencies,
    baseLengths,
    headLengths,
    confidence: stableAndRepeated ? "stable" : "inconclusive",
  };
}

function commonEvalNames(baseRuns: RunRecord[], headRuns: RunRecord[]): string[] {
  const base = new Set(baseRuns.flatMap((run) => run.evalResults.map((result) => result.name)));
  const head = new Set(headRuns.flatMap((run) => run.evalResults.map((result) => result.name)));
  return [...base].filter((name) => head.has(name)).sort();
}

function sequencesEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

type SkillDriftHypothesis = SkillDrift & { changed: boolean; rawPValue: number };
type SubagentDriftHypothesis = SubagentDrift & { changed: boolean; rawPValue: number };

function computeDrift(baseRuns: RunRecord[], headRuns: RunRecord[]): DriftSection {
  const evalNames = commonEvalNames(baseRuns, headRuns);
  const skillScopes: Array<string | null> = [
    ...evalNames,
    ...([...baseRuns, ...headRuns].some((run) =>
      run.skillLoads.some((load) => load.evalName === undefined),
    )
      ? [null]
      : []),
  ];
  const skillHypotheses: SkillDriftHypothesis[] = skillScopes.flatMap((evalName) => {
    const scopedBase = scopedRuns(baseRuns, evalName);
    const scopedHead = scopedRuns(headRuns, evalName);
    return proportionDrift(
      runsContaining(scopedBase, (run) =>
        run.skillLoads
          .filter((load) => (load.evalName ?? null) === evalName)
          .map((load) => load.name),
      ),
      runsContaining(scopedHead, (run) =>
        run.skillLoads
          .filter((load) => (load.evalName ?? null) === evalName)
          .map((load) => load.name),
      ),
      scopedBase.length,
      scopedHead.length,
    ).map((d) => ({
      evalName,
      name: d.name,
      baseLoadedRuns: d.baseRuns,
      baseTotalRuns: scopedBase.length,
      headLoadedRuns: d.headRuns,
      headTotalRuns: scopedHead.length,
      confidence: "inconclusive" as const,
      pValue: d.pValue,
      adjustedPValue: d.pValue,
      changed: d.changed,
      rawPValue: d.pValue,
    }));
  });

  const subagentScopes: Array<string | null> = [
    ...evalNames,
    ...([...baseRuns, ...headRuns].some((run) =>
      run.subagentCalls.some((call) => call.evalName === undefined),
    )
      ? [null]
      : []),
  ];
  const subagentHypotheses: SubagentDriftHypothesis[] = subagentScopes.flatMap((evalName) => {
    const scopedBase = scopedRuns(baseRuns, evalName);
    const scopedHead = scopedRuns(headRuns, evalName);
    return proportionDrift(
      runsContaining(scopedBase, (run) =>
        run.subagentCalls
          .filter((call) => (call.evalName ?? null) === evalName)
          .map((call) => call.name),
      ),
      runsContaining(scopedHead, (run) =>
        run.subagentCalls
          .filter((call) => (call.evalName ?? null) === evalName)
          .map((call) => call.name),
      ),
      scopedBase.length,
      scopedHead.length,
    ).map((d) => ({
      evalName,
      name: d.name,
      baseUsedRuns: d.baseRuns,
      baseTotalRuns: scopedBase.length,
      headUsedRuns: d.headRuns,
      headTotalRuns: scopedHead.length,
      confidence: "inconclusive" as const,
      pValue: d.pValue,
      adjustedPValue: d.pValue,
      changed: d.changed,
      rawPValue: d.pValue,
    }));
  });

  const statisticalHypotheses: Array<SkillDriftHypothesis | SubagentDriftHypothesis> = [
    ...skillHypotheses,
    ...subagentHypotheses,
  ];
  const adjustedDriftPValues = holmAdjusted(statisticalHypotheses.map((item) => item.rawPValue));
  statisticalHypotheses.forEach((item, index) => {
    const adjustedPValue = adjustedDriftPValues[index] as number;
    item.pValue = round(item.rawPValue, 6);
    item.adjustedPValue = round(adjustedPValue, 6);
    item.confidence =
      adjustedPValue <= DRIFT_ALPHA + 1e-12 ? "statistically-confirmed" : "inconclusive";
  });
  const skills: SkillDrift[] = skillHypotheses
    .filter((item) => item.changed)
    .map(({ changed: _changed, rawPValue: _rawPValue, ...item }) => item);
  const subagents: SubagentDrift[] = subagentHypotheses
    .filter((item) => item.changed)
    .map(({ changed: _changed, rawPValue: _rawPValue, ...item }) => item);

  const hasUnattributedCalls = [...baseRuns, ...headRuns].some((run) =>
    run.toolCalls.some((call) => call.evalName === undefined),
  );
  const toolScopes: Array<string | null> = [...evalNames, ...(hasUnattributedCalls ? [null] : [])];
  const toolSequences: ToolSequenceDrift[] = toolScopes
    .map((evalName): ToolSequenceDrift => {
      const scopedBase = scopedRuns(baseRuns, evalName);
      const scopedHead = scopedRuns(headRuns, evalName);
      const baseSeq = mostCommonSequence(scopedBase, evalName);
      const headSeq = mostCommonSequence(scopedHead, evalName);
      const diverged = !sequencesEqual(baseSeq.sequence, headSeq.sequence);
      const sequenceConfidence = !diverged
        ? null
        : baseSeq.tied || headSeq.tied || scopedBase.length < 2 || scopedHead.length < 2
          ? "inconclusive"
          : baseSeq.count === scopedBase.length && headSeq.count === scopedHead.length
            ? "stable"
            : "inconclusive";
      const sequenceReason =
        baseSeq.tied || headSeq.tied
          ? "modal sequence is tied within at least one ref"
          : sequenceConfidence === "stable"
            ? "each sequence repeated consistently within its ref"
            : "modal sequences differ, but within-ref variation makes the change inconclusive";
      return {
        evalName,
        baseMostCommon: baseSeq.sequence,
        baseMostCommonRuns: baseSeq.count,
        baseTotalRuns: scopedBase.length,
        headMostCommon: headSeq.sequence,
        headMostCommonRuns: headSeq.count,
        headTotalRuns: scopedHead.length,
        divergenceNote: diverged
          ? `most common tool sequence diverges: base saw it in ${baseSeq.count} of ${scopedBase.length} runs, ` +
            `head saw a different one in ${headSeq.count} of ${scopedHead.length} runs — ${sequenceReason}`
          : null,
        divergenceConfidence: sequenceConfidence,
        callCountDeltas: toolCountDeltas(scopedBase, scopedHead, evalName),
      };
    })
    .filter((sequence) => sequence.divergenceNote !== null || sequence.callCountDeltas.length > 0);

  const toolInputs = toolInputDeltas(baseRuns, headRuns);
  const outputScopes = evalNames.filter((evalName) =>
    [...baseRuns, ...headRuns].some((run) =>
      run.evalResults.some(
        (result) => result.name === evalName && result.finalOutput !== undefined,
      ),
    ),
  );
  const hasOnlyLegacyAggregateOutputs =
    outputScopes.length === 0 &&
    [...baseRuns, ...headRuns].some((run) => run.finalOutput !== undefined);
  const finalOutputs = [
    ...outputScopes.map((evalName) => finalOutputDelta(baseRuns, headRuns, evalName)),
    ...(hasOnlyLegacyAggregateOutputs ? [finalOutputDelta(baseRuns, headRuns, null)] : []),
  ].filter((value): value is FinalOutputDelta => value !== null);

  const hasDrift =
    skills.some((item) => item.confidence === "statistically-confirmed") ||
    subagents.some((item) => item.confidence === "statistically-confirmed") ||
    toolSequences.some(
      (sequence) =>
        sequence.divergenceConfidence === "stable" ||
        sequence.callCountDeltas.some((item) => item.confidence === "stable"),
    ) ||
    toolInputs.some((item) => item.confidence === "stable") ||
    finalOutputs.some((item) => item.confidence === "stable");
  const hasInconclusive =
    skills.some((item) => item.confidence === "inconclusive") ||
    subagents.some((item) => item.confidence === "inconclusive") ||
    toolSequences.some(
      (sequence) =>
        sequence.divergenceConfidence === "inconclusive" ||
        sequence.callCountDeltas.some((item) => item.confidence === "inconclusive"),
    ) ||
    toolInputs.some((item) => item.confidence === "inconclusive") ||
    finalOutputs.some((item) => item.confidence === "inconclusive");

  return { skills, toolSequences, subagents, toolInputs, finalOutputs, hasDrift, hasInconclusive };
}

// ---------------------------------------------------------------------------
// Cost & performance

function metricStats(values: number[]): MetricStats {
  return {
    median: round(median(values), 6),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function metricDelta(baseValues: number[] | null, headValues: number[] | null): MetricDelta {
  const base = baseValues && baseValues.length > 0 ? metricStats(baseValues) : null;
  const head = headValues && headValues.length > 0 ? metricStats(headValues) : null;
  let deltaPct: number | null = null;
  if (base && head && base.median !== 0) {
    deltaPct = round(((head.median - base.median) / base.median) * 100, 1);
  }
  return { base, head, deltaPct };
}

/** Cost values are usable only when every run has a non-null cost and they are not all zero. */
function usableCosts(runs: RunRecord[]): number[] | null {
  const costs = runs.map((r) => r.costUsd);
  if (!costs.every((c): c is number => c !== null)) return null;
  if (costs.every((c) => c === 0)) return null;
  return costs;
}

function computeCostPerf(
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
  for (const metric of PERFORMANCE_METRICS) {
    if (!Number.isFinite(thresholds[metric]) || thresholds[metric] < 0) {
      throw new Error(`computeDelta: performance threshold for ${metric} must be non-negative`);
    }
  }
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
      delta.deltaPct !== null &&
      delta.deltaPct > 0 &&
      delta.deltaPct > thresholdPct &&
      delta.base !== null &&
      delta.head !== null
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

// ---------------------------------------------------------------------------
// Verdict & caveats

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
  const sign = regression.deltaPct >= 0 ? "+" : "";
  return (
    `${PERFORMANCE_LABELS[regression.metric]} performance regression: median increased ${sign}` +
    `${regression.deltaPct}% (threshold ${regression.thresholdPct}%; ` +
    `base ${regression.baseMedian}, head ${regression.headMedian})`
  );
}

function classifyEnforcement(
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
  if (drift.hasInconclusive) {
    add("behavioral-drift", "behavioral differences detected with inconclusive confidence");
  }
  for (const mismatch of mismatches) add("comparison-validity", mismatch);
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

/** True when a report violates any selected granular policy category. */
export function violatesEnforcement(
  report: DeltaReport,
  categories: readonly EnforcementCategory[],
): boolean {
  const selected = new Set(categories);
  return report.enforcement.violations.some((violation) => selected.has(violation.category));
}

function computeVerdict(
  evals: EvalDelta[],
  drift: DriftSection,
  costPerf: CostPerf,
  baseN: number,
  headN: number,
  mismatches: string[],
): { verdict: Verdict; verdictSummary: string; verdictReasons: string[] } {
  const reasons: string[] = [];

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
    if (sequence.divergenceNote !== null) {
      reasons.push(`tool sequence change${scope}: ${sequence.divergenceNote}`);
    }
    for (const t of sequence.callCountDeltas) {
      reasons.push(
        `tool ${t.confidence === "stable" ? "drift" : "change (inconclusive)"}${scope}: ` +
          `${t.name} median calls/run ${t.baseMedianCalls} on base vs ` +
          `${t.headMedianCalls} on head`,
      );
    }
  }
  for (const s of drift.subagents) {
    reasons.push(
      `subagent ${s.confidence === "statistically-confirmed" ? "drift" : "change (inconclusive)"}: ` +
        `${s.name} used in ${s.baseUsedRuns} of ${s.baseTotalRuns} base runs vs ` +
        `${s.headUsedRuns} of ${s.headTotalRuns} head runs (two-sided Fisher raw p=${formatP(
          s.pValue,
        )}, Holm-adjusted p=${formatP(s.adjustedPValue)})`,
    );
  }
  for (const input of drift.toolInputs) {
    const scope = input.evalName ? ` in eval ${input.evalName}` : "";
    reasons.push(
      `tool input ${input.confidence === "stable" ? "drift" : "change (inconclusive)"}: ` +
        `${input.toolName} call ${input.occurrence}${scope} used different input fingerprints`,
    );
  }
  for (const output of drift.finalOutputs) {
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
    drift.hasInconclusive ||
    hasPerformanceRegression ||
    costAvailabilityMismatch ||
    mismatches.length > 0 ||
    reviewEvals.length > 0 ||
    materialScoreRegressions.length > 0
  ) {
    const summaryParts: string[] = [];
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
    if (drift.hasInconclusive) {
      summaryParts.push(
        drift.hasDrift
          ? "additional behavioral differences inconclusive"
          : "behavioral differences inconclusive",
      );
    }
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
    verdictSummary: `No regressions or behavioral drift detected across ${phrase}${flakySuffix}`,
    verdictReasons: reasons.length > 0 ? reasons : ["no regressions or behavioral drift detected"],
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

function computeCaveats(
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

// ---------------------------------------------------------------------------
// Run summaries

function summarizeRun(run: RunRecord): RunSummary {
  return {
    runIndex: run.runIndex,
    evalsPassed: run.evalResults.filter((e) => e.passed).length,
    evalsTotal: run.evalResults.length,
    toolCallCount: run.toolCalls.length,
    skillsLoaded: [...new Set(run.skillsLoaded)].sort(),
    costUsd: run.costUsd,
    durationMs: run.durationMs,
  };
}
