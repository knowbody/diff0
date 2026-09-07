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
import { availableCost, summarizeCostSource, usableCosts } from "../cost.js";
import { computeDrift } from "./drift.js";
import { collectScoreComparabilityMismatches, computeEvalDeltas } from "./evals.js";
import { computeCostPerf } from "./performance.js";
import { classifyEnforcement, computeCaveats, computeVerdict } from "./verdict.js";

export { validatePerformanceThresholds } from "./performance.js";
export { violatesEnforcement } from "./policy.js";

import type { RunRecord } from "../types.js";
import type {
  ComparisonMeta,
  CostSource,
  DataSourcesSummary,
  DeltaReport,
  GitDiffStat,
  PerformanceThresholds,
  RefMeta,
  RunSummary,
  SourcePresence,
} from "./types.js";

export * from "./constants.js";
export interface ComputeDeltaOptions {
  /** How per-run costUsd was derived. Legacy batch source override; per-record provenance is used when omitted. */
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
  const records = [...baseRuns, ...headRuns];
  const costs = usableCosts(records);
  if (costs === null) return { total: null, source: "unavailable" };
  return {
    total: costs.reduce((sum, cost) => sum + cost, 0),
    source: declaredSource ?? summarizeCostSource(records),
  };
}

function summarizeRun(run: RunRecord): RunSummary {
  return {
    runIndex: run.runIndex,
    evalsPassed: run.evalResults.filter((e) => e.passed).length,
    evalsTotal: run.evalResults.length,
    toolCallCount: run.toolCalls.length,
    skillsLoaded: [...new Set(run.skillsLoaded)].sort(),
    costUsd: availableCost(run),
    durationMs: run.durationMs,
  };
}
