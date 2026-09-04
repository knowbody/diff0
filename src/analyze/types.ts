/**
 * Analysis-layer model. `computeDelta()` (src/analyze/delta.ts) turns two
 * RunRecord[] arrays into a DeltaReport; the renderers in src/report/ are
 * deliberately dumb and only format what is precomputed here.
 *
 * Honest-framing invariants encoded in this model:
 * - Everything is a statistical comparison across N runs, never a
 *   deterministic diff ("passed 3 of 3 runs", never "passes").
 * - Eval regressions require directional Fisher-exact evidence, so a single
 *   opposing run is inconclusive rather than an authoritative regression.
 * - Missing data is surfaced as missing (cost "unavailable", never $0).
 */
import type { SandboxBackend } from "../types.js";

/** Where the per-run costUsd figures came from. */
export type CostSource = "gateway" | "priced-tokens" | "unavailable";

/** How consistently a data source fed the runs of this comparison. */
export type SourcePresence = "all" | "partial" | "none";

/** Presence of each capture source across every run of both refs. */
export interface DataSourcesSummary {
  evalJson: SourcePresence;
  spans: SourcePresence;
  logs: SourcePresence;
}

/** One file's line stats from `git diff --stat` between the two refs. */
export interface GitDiffFileStat {
  path: string;
  insertions: number;
  deletions: number;
}

/** Supplied by the caller (the harness owns git); null when unavailable. */
export interface GitDiffStat {
  files: GitDiffFileStat[];
  /** e.g. "3 files changed, 25 insertions(+), 7 deletions(-)" */
  summary: string;
}

/** Identity of one side of the comparison, folded across its runs. */
export interface RefMeta {
  ref: string;
  commitSha: string;
  /** Distinct values joined with " / " when runs within the ref disagree (also flagged in mismatches). */
  eveVersion: string;
  model: string;
  sandboxBackend: SandboxBackend | string;
  /** True only for legacy/programmatic reports that label a backend from inference. */
  sandboxInferred: boolean;
  runs: number;
}

export interface ComparisonMeta {
  base: RefMeta;
  head: RefMeta;
  /** Base-side N. When head N differs, `mismatches` carries an entry. */
  runsPerRef: number;
  /** Sum across all runs of both refs; null when any run lacks cost data (never a misleading partial sum). */
  totalComparisonCostUsd: number | null;
  costSource: CostSource;
  dataSources: DataSourcesSummary;
  /** Host capability probe only; not evidence of either app's actual sandbox. */
  hostDefaultSandboxCandidate?: SandboxBackend;
  /** ISO 8601. Injectable via ComputeDeltaOptions.now for deterministic output. */
  generatedAt: string;
  /**
   * Comparison-validity problems: model/Eve version/run evidence differing between
   * refs (or inconsistent within one ref), differing run counts. Non-empty
   * mismatches feed the report's validity warning block.
   */
  mismatches: string[];
  gitDiffStat: GitDiffStat | null;
}

/**
 * Eval status semantics (encoded exactly — see delta.test.ts guardrails):
 * - regressed/improved: a directional pass-rate change supported by a
 *   Holm-adjusted one-sided Fisher exact p-value <= 0.05, including probabilistic changes.
 * - inconclusive-*: a directional change was observed but lacks that evidence.
 * - flaky-*: pass proportions match, but the named ref(s) saw both outcomes.
 * - fail: consistently failing on BOTH refs — a pre-existing failure, not a regression.
 * - partial-*: the eval was absent from at least one, but not all, runs on the named ref(s).
 * - missing-*: eval only exists on the other ref (missing-base = new on head).
 */
export type EvalStatus =
  | "pass"
  | "regressed"
  | "improved"
  | "fail"
  | "flaky-base"
  | "flaky-head"
  | "flaky-both"
  | "inconclusive-regression"
  | "inconclusive-improvement"
  | "partial-base"
  | "partial-head"
  | "partial-both"
  | "missing-base"
  | "missing-head";

/** Median soft (scored) assertion values per ref, when assertions carry scores. */
export interface SoftScoreDelta {
  baseMedian: number;
  headMedian: number;
  delta: number;
  /** Absolute score movement required before a scorer-only change affects the verdict. */
  materialThreshold: number;
  classification: "material-regression" | "material-improvement" | "within-threshold";
}

/**
 * A LABELED statistical hint, never a verdict. Only computed when the eval is
 * consistent within each ref and the pass proportions differ. At N=3 per ref
 * the maximum |z| is ~2.45 — suggestive, not significant; the note says so.
 */
export interface TwoProportionHint {
  zScore: number;
  note: string;
}

/** Machine-readable evidence behind an eval's displayed status. */
export interface EvalStatisticalEvidence {
  classification: "regressed" | "improved" | "equivalent" | "inconclusive";
  method: "one-sided-fisher-exact";
  /** null when one side is missing or the observed proportions are equal. */
  pValue: number | null;
  /** Family-wise-error-controlled p-value across all comparable evals in the comparison. */
  adjustedPValue: number | null;
  correction: "holm";
  comparisons: number;
  alpha: number;
  note: string;
}

export interface EvalDelta {
  name: string;
  /** Runs of the base ref in which this eval passed / was executed (0/0 when missing-base). */
  basePassed: number;
  baseTotal: number;
  /** Suite runs expected on base; greater than baseTotal means partial eval coverage. */
  baseExpectedRuns: number;
  headPassed: number;
  headTotal: number;
  /** Suite runs expected on head; greater than headTotal means partial eval coverage. */
  headExpectedRuns: number;
  status: EvalStatus;
  statisticalEvidence: EvalStatisticalEvidence;
  softScores?: SoftScoreDelta;
  twoProportionHint?: TwoProportionHint;
}

/** Statistical evidence and deterministic repetition are intentionally distinct claims. */
export type DriftConfidence = "statistically-confirmed" | "stable" | "inconclusive";

/** A skill whose load proportion differs between refs ("in X of N runs" language). */
export interface SkillDrift {
  /** Eval whose skill usage is compared; null means the load was unattributed. */
  evalName: string | null;
  name: string;
  baseLoadedRuns: number;
  baseTotalRuns: number;
  headLoadedRuns: number;
  headTotalRuns: number;
  confidence: DriftConfidence;
  /** Two-sided Fisher exact p-value for the observed load proportions. */
  pValue: number;
  adjustedPValue: number;
}

/** A tool whose median calls-per-run differs between refs. */
export interface ToolCountDelta {
  evalName: string | null;
  name: string;
  baseMedianCalls: number;
  headMedianCalls: number;
  confidence: DriftConfidence;
}

export interface ToolSequenceDrift {
  /** Eval whose trajectory is compared; null means calls Eve could not attribute. */
  evalName: string | null;
  /** Most common per-run tool-call sequence on base (empty array = no tool calls). */
  baseMostCommon: string[];
  /** How many base runs produced exactly that sequence. */
  baseMostCommonRuns: number;
  baseTotalRuns: number;
  headMostCommon: string[];
  headMostCommonRuns: number;
  headTotalRuns: number;
  /** Set when the most-common sequences differ between refs; null otherwise. */
  divergenceNote: string | null;
  divergenceConfidence: DriftConfidence | null;
  /** Per-tool call-count deltas, only for tools whose per-run medians differ. */
  callCountDeltas: ToolCountDelta[];
}

/** A subagent whose delegation proportion differs between refs. */
export interface SubagentDrift {
  /** Eval whose delegation is compared; null means the call was unattributed. */
  evalName: string | null;
  name: string;
  baseUsedRuns: number;
  baseTotalRuns: number;
  headUsedRuns: number;
  headTotalRuns: number;
  confidence: DriftConfidence;
  pValue: number;
  adjustedPValue: number;
}

/** Changed privacy-preserving inputs at an aligned tool-call location. */
export interface ToolInputDelta {
  evalName: string | null;
  toolName: string;
  /** 1-based occurrence of this tool within the eval (or unattributed run). */
  occurrence: number;
  /** Distinct hashes only; raw tool inputs are never retained or rendered. */
  baseHashes: string[];
  headHashes: string[];
  /** Per-fingerprint run counts, exposing distribution shifts without raw inputs. */
  baseFrequencies: Array<{ hash: string; runs: number }>;
  headFrequencies: Array<{ hash: string; runs: number }>;
  /** Runs in which this aligned call had a captured fingerprint. */
  baseHashRuns: number;
  headHashRuns: number;
  confidence: DriftConfidence;
}

/** Changed privacy-preserving final-output identities. */
export interface FinalOutputDelta {
  evalName: string | null;
  baseCapturedRuns: number;
  baseTotalRuns: number;
  headCapturedRuns: number;
  headTotalRuns: number;
  baseHashes: string[];
  headHashes: string[];
  /** Per-fingerprint run counts, exposing output-distribution shifts without raw output. */
  baseFrequencies: Array<{ hash: string; runs: number }>;
  headFrequencies: Array<{ hash: string; runs: number }>;
  baseLengths: number[];
  headLengths: number[];
  confidence: DriftConfidence;
}

export interface DriftSection {
  skills: SkillDrift[];
  toolSequences: ToolSequenceDrift[];
  subagents: SubagentDrift[];
  toolInputs: ToolInputDelta[];
  finalOutputs: FinalOutputDelta[];
  /** True only for changes supported by repeated/stable or statistical evidence. */
  hasDrift: boolean;
  /** True when a change was observed but the available samples do not support confident drift. */
  hasInconclusive: boolean;
}

/** Median and range; small default samples do not support stable higher moments. */
export interface MetricStats {
  median: number;
  min: number;
  max: number;
}

export interface MetricDelta {
  /** null = metric unavailable for that ref (e.g. no cost source). */
  base: MetricStats | null;
  head: MetricStats | null;
  /** (head.median - base.median) / base.median * 100; null when incomputable. */
  deltaPct: number | null;
}

export interface CostPerf {
  /** base/head are null (unavailable) when any run lacks cost or all costs are zero. */
  costUsd: MetricDelta;
  tokensIn: MetricDelta;
  tokensOut: MetricDelta;
  cacheReadTokens: MetricDelta;
  cacheWriteTokens: MetricDelta;
  durationMs: MetricDelta;
  /** Directional median increases that exceeded the configured percentage budgets. */
  regressions: PerformanceRegression[];
}

/** Metrics whose increases can violate a directional performance budget. */
export type PerformanceMetric = "costUsd" | "tokensIn" | "tokensOut" | "durationMs";

/** Percentage budgets are increase-only: improvements never create a regression. */
export type PerformanceThresholds = Record<PerformanceMetric, number>;

/** Machine-readable evidence for one exceeded directional performance budget. */
export interface PerformanceRegression {
  metric: PerformanceMetric;
  baseMedian: number;
  headMedian: number;
  deltaPct: number;
  thresholdPct: number;
}

/** Independently selectable policy categories; callers never need to parse verdict prose. */
export type EnforcementCategory =
  | "eval-regression"
  | "score-regression"
  | "performance-regression"
  | "behavioral-drift"
  | "comparison-validity";

/** One category violated by the comparison, with human-readable supporting evidence. */
export interface EnforcementViolation {
  category: EnforcementCategory;
  reasons: string[];
}

export interface EnforcementClassification {
  /** Contains at most one entry per category, in stable category order. */
  violations: EnforcementViolation[];
}

/**
 * red    = at least one statistically confirmed REGRESSED eval, or a complete all-pass base to
 *          all-fail head collapse across at least 3 runs per ref (an operational regression).
 * yellow = no confirmed regression, but a comparison-validity warning,
 *          removed/added/flaky/inconclusive eval, behavioral change, or a directional
 *          cost/duration/token budget regression requires review.
 * green  = no confirmed or reviewable change.
 */
export type Verdict = "green" | "yellow" | "red";

/** Raw per-run facts for the report's collapsible details section. */
export interface RunSummary {
  runIndex: number;
  evalsPassed: number;
  evalsTotal: number;
  toolCallCount: number;
  skillsLoaded: string[];
  costUsd: number | null;
  durationMs: number;
}

export interface DeltaReport {
  meta: ComparisonMeta;
  verdict: Verdict;
  /** One-line human phrase for the verdict (title line of every renderer). */
  verdictSummary: string;
  /** Every signal that contributed to the verdict, in plain language. */
  verdictReasons: string[];
  /** Sorted most-severe-first (regressed, removed/inconclusive, flaky, fail, added/improved/pass). */
  evals: EvalDelta[];
  drift: DriftSection;
  costPerf: CostPerf;
  /** Granular policy findings, independent of the legacy green/yellow/red presentation. */
  enforcement: EnforcementClassification;
  /**
   * Honest-framing caveats renderers MUST surface: N=1 flakiness-undetectable
   * warning, the "--runs 5" recommendation, and the external-side-effect limitation.
   */
  caveats: string[];
  /** False when either ref has fewer than 2 runs — a single run cannot reveal flakiness. */
  flakinessDetectable: boolean;
  runSummaries: {
    base: RunSummary[];
    head: RunSummary[];
  };
}
