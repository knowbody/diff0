import reportJson from "@/content/drift-report.json";

const report = reportJson;
type Range = typeof report.costPerf.costUsd.base;
type RunSummary = (typeof report.runSummaries.base)[number];

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Showcase report is missing ${label}.`);
  return value;
}

const usd = (value: number) => `$${value.toFixed(4)}`;
const integer = (value: number) => value.toLocaleString("en-US");
const seconds = (value: number) => `${(value / 1000).toFixed(1)}s`;
const percent = (value: number) => `${Math.round(value)}%`;
const pValue = (value: number) => value.toFixed(4);

function range(value: Range, format: (number: number) => string): string {
  return `${format(value.median)} (${format(value.min)}–${format(value.max)})`;
}

function metricRow(
  label: string,
  metric: { base: Range; head: Range; deltaPct: number },
  format: (number: number) => string,
) {
  return {
    label,
    base: range(metric.base, format),
    head: range(metric.head, format),
    delta: percent(metric.deltaPct),
  };
}

function evalStatus(status: string): { label: string; title?: string } {
  if (status === "pass") return { label: "✅ pass" };
  const title =
    "the observed pass rate changed, but the Fisher test did not clear the adjusted threshold";
  if (status === "inconclusive-regression") {
    return { label: "🟡 lower pass rate (inconclusive)", title };
  }
  if (status === "inconclusive-improvement") {
    return { label: "🟡 higher pass rate (inconclusive)", title };
  }
  throw new Error(`Unsupported showcase eval status: ${status}`);
}

function verdictIcon(verdict: string): string {
  if (verdict === "green") return "🟢";
  if (verdict === "yellow") return "🟡";
  if (verdict === "red") return "🔴";
  throw new Error(`Unsupported showcase verdict: ${verdict}`);
}

function runRows(runs: RunSummary[]): [string, string, string, string, string, string][] {
  return runs.map((run) => [
    String(run.runIndex + 1),
    `${run.evalsPassed}/${run.evalsTotal}`,
    String(run.toolCallCount),
    run.skillsLoaded.join(", ") || "—",
    usd(run.costUsd),
    seconds(run.durationMs),
  ]);
}

const subagent = required(
  report.drift.subagents.find((entry) => entry.name === "reporter"),
  "reporter subagent evidence",
);
const changedFile = required(report.meta.gitDiffStat.files[0], "changed-file evidence");
const total = (side: "base" | "head", field: "Passed" | "Total") =>
  report.evals.reduce((sum, row) => sum + row[`${side}${field}`], 0);
const modelDisplay = report.meta.base.model
  .split("/")
  .at(-1)
  ?.split("-")
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(" ");

export const showcase = {
  verdictIcon: verdictIcon(report.verdict),
  verdictSummary: report.verdictSummary,
  base: report.meta.base,
  head: report.meta.head,
  modelDisplay: required(modelDisplay, "model identity"),
  runsPerRef: report.meta.runsPerRef,
  comparisonCost: usd(report.meta.totalComparisonCostUsd),
  costSource: report.meta.costSource,
  evalPasses: {
    base: `${total("base", "Passed")} / ${total("base", "Total")}`,
    head: `${total("head", "Passed")} / ${total("head", "Total")}`,
  },
  evals: report.evals.map((row) => ({
    name: row.name,
    base: `${row.basePassed}/${row.baseTotal}`,
    head: `${row.headPassed}/${row.headTotal}`,
    ...evalStatus(row.status),
  })),
  subagent: {
    ...subagent,
    base: `${subagent.baseUsedRuns} / ${subagent.baseTotalRuns} runs`,
    head: `${subagent.headUsedRuns} / ${subagent.headTotalRuns} runs`,
    rawPValue: pValue(subagent.pValue),
    holmPValue: pValue(subagent.adjustedPValue),
  },
  costPerSession: {
    base: usd(report.costPerf.costUsd.base.median),
    head: usd(report.costPerf.costUsd.head.median),
    delta: percent(report.costPerf.costUsd.deltaPct),
  },
  metrics: [
    metricRow("Cost / session", report.costPerf.costUsd, usd),
    metricRow("Tokens in", report.costPerf.tokensIn, integer),
    metricRow("Tokens out", report.costPerf.tokensOut, integer),
    metricRow("Duration", report.costPerf.durationMs, seconds),
  ],
  changedFile,
  diffSummary: report.meta.gitDiffStat.summary,
  runRows: {
    base: runRows(report.runSummaries.base),
    head: runRows(report.runSummaries.head),
  },
} as const;
