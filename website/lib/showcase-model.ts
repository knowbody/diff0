import { z } from "zod";

const count = z.number().int().nonnegative().safe();
const nonempty = z.string().min(1);
const stats = z
  .object({
    median: z.number().nonnegative(),
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  })
  .refine((s) => s.min <= s.median && s.median <= s.max, "Median must be within its range.");
const metric = z.object({ base: stats, head: stats, reportedDeltaPct: z.number() });
const evalCounts = z
  .object({ passed: count, total: count, score: z.number().min(0).max(1) })
  .refine((e) => e.passed <= e.total, "Passed count cannot exceed total.");
const ref = z.object({ ref: nonempty, commitSha: z.string().regex(/^[a-f0-9]{40}$/) });

/** Historical report snapshot. Percentage deltas retain the source report's precision. */
export const showcaseSchema = z
  .object({
    sourceUrl: z.url(),
    archivePath: z.string().regex(/^\/evidence\/showcase-\d{4}-\d{2}-\d{2}\.txt$/),
    pullRequestUrl: z.url(),
    capturedAt: z.iso.date(),
    releaseVersion: nonempty,
    eveVersion: nonempty,
    model: nonempty,
    sandbox: nonempty,
    hostDefaultSandboxCandidate: nonempty,
    base: ref,
    head: ref,
    runsPerRef: count.positive(),
    verdict: z.enum(["green", "yellow", "red"]),
    confirmedEvalRegressions: count,
    inconclusiveSignalCount: count,
    evals: z.array(z.object({ name: nonempty, base: evalCounts, head: evalCounts })).min(1),
    metrics: z.object({ toolCalls: metric, outputTokens: metric, durationSeconds: metric }),
    subagent: z.object({
      name: nonempty,
      confidence: z.enum(["confirmed", "inconclusive"]),
      rawPValue: nonempty,
      holmPValue: nonempty,
      baseUsedRuns: count,
      baseTotalRuns: count,
      headUsedRuns: count,
      headTotalRuns: count,
      evalNames: z.array(nonempty).min(1),
    }),
    changedFile: z.object({ path: nonempty, insertions: count, deletions: count }),
    costUsd: z.object({ base: stats.nullable(), head: stats.nullable() }),
    costNote: nonempty,
    numericPrecision: nonempty,
  })
  .superRefine((data, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const pr = new URL(data.pullRequestUrl);
    const report = new URL(data.sourceUrl);
    const workflow = report.pathname.match(/^(\/[^/]+\/[^/]+)\/actions\/runs\/\d+\/attempts\/\d+$/);
    if (
      pr.protocol !== "https:" ||
      pr.hostname !== "github.com" ||
      !/\/pull\/\d+$/.test(pr.pathname) ||
      report.origin !== pr.origin ||
      workflow?.[1] !== pr.pathname.replace(/\/pull\/\d+$/, "") ||
      report.hash !== "" ||
      report.search !== ""
    )
      issue("Provenance must identify a GitHub PR and a workflow attempt in the same repository.");
    const confirmedDrift =
      data.subagent.confidence === "confirmed" &&
      data.subagent.baseUsedRuns * data.subagent.headTotalRuns !==
        data.subagent.headUsedRuns * data.subagent.baseTotalRuns;
    if (data.verdict === "green" && (data.confirmedEvalRegressions > 0 || confirmedDrift))
      issue("A green snapshot cannot contain confirmed regression or drift.");
    const names = new Set(data.evals.map((e) => e.name));
    if (names.size !== data.evals.length) issue("Eval names must be unique.");
    for (const side of ["base", "head"] as const) {
      if (data.evals.some((e) => e[side].total > data.runsPerRef))
        issue("Eval totals cannot exceed runs per ref.");
      if (
        data.subagent[`${side}UsedRuns`] > data.subagent[`${side}TotalRuns`] ||
        data.subagent[`${side}TotalRuns`] > data.runsPerRef
      )
        issue("Subagent counts must fit the observed run count.");
    }
    if (
      data.subagent.evalNames.some((name) => !names.has(name)) ||
      new Set(data.subagent.evalNames).size !== data.subagent.evalNames.length
    )
      issue("Subagent scope must name distinct captured evals.");
  });

type Snapshot = z.infer<typeof showcaseSchema>;
type MetricId = keyof Snapshot["metrics"];

const metricDefinitions = {
  toolCalls: { label: "Tool calls / run (agents excluded)", seconds: false },
  outputTokens: { label: "Output tokens / run", seconds: false },
  durationSeconds: { label: "Duration / run", seconds: true },
} as const;

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;

/** Format captured numbers once; never infer data from a display label or formatted string. */
export function createShowcase(input: unknown) {
  const parsed = showcaseSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(`Showcase data is invalid: ${parsed.error.message}`, { cause: parsed.error });
  const source = parsed.data;
  const formatMetric = (id: MetricId) => {
    const metric = source.metrics[id];
    const definition = metricDefinitions[id];
    const format = (n: number) =>
      definition.seconds ? `${n.toFixed(1)}s` : n.toLocaleString("en-US");
    const stats = (s: typeof metric.base) =>
      s.min === s.max
        ? format(s.median)
        : `${format(s.median)} (${format(s.min)}–${format(s.max)})`;
    return {
      id,
      label: definition.label,
      base: stats(metric.base),
      head: stats(metric.head),
      baseShort: format(metric.base.median),
      headShort: format(metric.head.median),
      delta: `${signed(metric.reportedDeltaPct)}%`,
      deltaMagnitude: `${Math.abs(metric.reportedDeltaPct)}%`,
    };
  };
  const passing = (side: "base" | "head") =>
    source.evals.filter(
      (e) => e[side].total === source.runsPerRef && e[side].passed === source.runsPerRef,
    ).length;
  const observations = (side: "base" | "head") =>
    source.evals.reduce(
      (sum, e) => ({ passed: sum.passed + e[side].passed, total: sum.total + e[side].total }),
      { passed: 0, total: 0 },
    );
  const base = observations("base");
  const head = observations("head");
  const passingChange = passing("head") - passing("base");
  const subagent = {
    ...source.subagent,
    scope: plural(source.subagent.evalNames.length, "eval"),
    base: `${source.subagent.baseUsedRuns} / ${source.subagent.baseTotalRuns} runs`,
    head: `${source.subagent.headUsedRuns} / ${source.subagent.headTotalRuns} runs`,
  };
  const outputTokens = formatMetric("outputTokens");
  const duration = formatMetric("durationSeconds");
  const verdictTitle =
    source.verdict === "yellow"
      ? "Review recommended."
      : source.verdict === "red"
        ? "Regression detected."
        : "No confirmed regression.";
  const regressionSummary =
    source.confirmedEvalRegressions === 0
      ? `No confirmed eval regressions across ${source.runsPerRef} runs per ref.`
      : `${plural(source.confirmedEvalRegressions, "confirmed eval regression")} across ${source.runsPerRef} runs per ref.`;
  const headAllPassed =
    head.passed === head.total && head.total === source.runsPerRef * source.evals.length;
  const observedDrift =
    subagent.baseUsedRuns * subagent.headTotalRuns !==
    subagent.headUsedRuns * subagent.baseTotalRuns;
  const confirmedDrift = observedDrift && subagent.confidence === "confirmed";
  const comparisonTitle =
    source.verdict === "red"
      ? "Regression detected"
      : confirmedDrift
        ? "Drift detected"
        : source.verdict === "yellow"
          ? "Review recommended"
          : "Comparison complete";
  const verdictExplanation =
    source.verdict === "yellow"
      ? "The yellow verdict asks a human to review the captured evidence."
      : source.verdict === "red"
        ? "The red verdict identifies a regression requiring review."
        : "The green verdict reports no confirmed regression or drift.";
  const delegationSummary =
    subagent.baseUsedRuns > 0 && subagent.headUsedRuns === 0
      ? "Repeated runs reveal that delegation vanished completely."
      : observedDrift
        ? `Repeated runs show ${subagent.confidence} movement in delegation.`
        : "Repeated runs show unchanged delegation frequency.";
  const ogRegression =
    source.confirmedEvalRegressions > 0
      ? "confirmed regression"
      : source.verdict === "red"
        ? "no confirmed eval regression"
        : "no confirmed regression";
  const ogTitle = `real-model ${source.verdict === "red" ? "regression" : confirmedDrift ? "drift" : "comparison"} · ${ogRegression}`;
  return {
    ...source,
    headCostLabel:
      source.costUsd.head === null
        ? "Unavailable"
        : `$${source.costUsd.head.median.toFixed(4)} / session`,
    modelDisplay:
      source.model
        .split("/")
        .at(-1)
        ?.split("-")
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ") ?? source.model,
    pullRequestNumber: Number(new URL(source.pullRequestUrl).pathname.split("/").at(-1)),
    sourceDiffUrl: `${source.pullRequestUrl.replace(/\/pull\/\d+$/, "")}/compare/${source.base.commitSha}...${source.head.commitSha}`,
    snapshotLabel: `Captured ${source.capturedAt} · diff0 v${source.releaseVersion}`,
    verdictTitle,
    verdictIcon: { green: "🟢", yellow: "🟡", red: "🔴" }[source.verdict],
    comparisonTitle,
    verdictBadge: { green: "clear", yellow: "review", red: "regression" }[source.verdict],
    verdictExplanation,
    evalTitle: headAllPassed ? "Green evals" : "Eval outcomes",
    delegationTitle: observedDrift ? "Visible drift" : "Delegation evidence",
    delegationSummary,

    headEvalSummary:
      head.passed === head.total && head.total === source.runsPerRef * source.evals.length
        ? "The head clears every eval observation."
        : `The head passes ${head.passed} of ${head.total} captured eval observations.`,
    performanceSummary: `${outputTokens.deltaMagnitude} ${source.metrics.outputTokens.reportedDeltaPct < 0 ? "fewer" : "more"} median output tokens and ${duration.deltaMagnitude} ${source.metrics.durationSeconds.reportedDeltaPct < 0 ? "lower" : "higher"} median duration`,
    verdictSummary: `${regressionSummary} ${confirmedDrift ? "Confirmed behavioral drift requires review." : observedDrift ? "Behavioral evidence is inconclusive." : "No change in delegation frequency was observed."}`,
    metrics: (Object.keys(metricDefinitions) as MetricId[]).map(formatMetric),
    featuredMetrics: { outputTokens, duration },
    evals: source.evals.map((e) => ({
      name: e.name,
      base: `${e.base.passed}/${e.base.total}`,
      head: `${e.head.passed}/${e.head.total}`,
      result:
        e.head.passed === source.runsPerRef && e.head.total === source.runsPerRef
          ? "✅ pass"
          : "review",
    })),
    evalObservations: {
      basePassed: base.passed,
      baseTotal: base.total,
      headPassed: head.passed,
      headTotal: head.total,
    },
    evalsPassingEveryRun: {
      base: `${passing("base")}/${source.evals.length}`,
      head: `${passing("head")}/${source.evals.length}`,
      change: passingChange === 0 ? "unchanged" : signed(passingChange),
    },
    evalPasses: { base: `${base.passed} / ${base.total}`, head: `${head.passed} / ${head.total}` },
    evalObservationTotal: { passed: base.passed + head.passed, total: base.total + head.total },
    subagent,
    sourceFileCount: 1,
    diffSummary: `1 file changed, ${plural(source.changedFile.insertions, "insertion")}(+), ${plural(source.changedFile.deletions, "deletion")}(-)`,
    sourceSummary: `The head passed ${head.passed === head.total ? `all ${head.total}` : `${head.passed} of ${head.total}`} eval observations while ${subagent.confidence} ${subagent.name} delegation was ${subagent.baseUsedRuns}/${subagent.baseTotalRuns} on base and ${subagent.headUsedRuns}/${subagent.headTotalRuns} on head in each of ${subagent.scope}.`,
    inconclusiveNote: `${plural(source.inconclusiveSignalCount, "additional inconclusive signal")} ${source.inconclusiveSignalCount === 1 ? "is" : "are"} available in the full comparison details.`,
    ogEvidence: `${subagent.name}: ${subagent.baseUsedRuns}/${subagent.baseTotalRuns} -> ${subagent.headUsedRuns}/${subagent.headTotalRuns} · output ${outputTokens.delta} · duration ${duration.delta}`,
    ogTitle,
    ogDescription: `diff0: ${ogTitle}. ${subagent.name} subagent ${subagent.baseUsedRuns}/${subagent.baseTotalRuns} to ${subagent.headUsedRuns}/${subagent.headTotalRuns}; median output tokens ${outputTokens.delta} and duration ${duration.delta}.`,
  };
}
