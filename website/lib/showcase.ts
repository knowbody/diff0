import showcaseJson from "@/content/showcase.json";

const titleCaseModel = showcaseJson.model
  .split("/")
  .at(-1)
  ?.split("-")
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(" ");

if (!titleCaseModel) throw new Error("Showcase data is missing a model identity.");

function metric(label: string) {
  const found = showcaseJson.metrics.find((entry) => entry.label === label);
  if (!found) throw new Error(`Showcase data is missing the ${label} metric.`);
  return found;
}

const outputTokens = metric("Output tokens / run");
const duration = metric("Duration / run");
const concise = (value: string) => value.split(" ")[0] ?? value;
const allRuns = `${showcaseJson.runsPerRef}/${showcaseJson.runsPerRef}`;
const baseEvalsPassingEveryRun = showcaseJson.evals.filter((entry) => entry.base === allRuns).length;
const headEvalsPassingEveryRun = showcaseJson.evals.filter((entry) => entry.head === allRuns).length;
const evalsPassingDelta = headEvalsPassingEveryRun - baseEvalsPassingEveryRun;

export const showcase = {
  ...showcaseJson,
  modelDisplay: titleCaseModel,
  evalsPassingEveryRun: {
    base: `${baseEvalsPassingEveryRun}/${showcaseJson.evals.length}`,
    head: `${headEvalsPassingEveryRun}/${showcaseJson.evals.length}`,
    change: evalsPassingDelta === 0 ? "unchanged" : `${evalsPassingDelta > 0 ? "+" : ""}${evalsPassingDelta}`,
  },
  evalPasses: {
    base: `${showcaseJson.evalObservations.basePassed} / ${showcaseJson.evalObservations.baseTotal}`,
    head: `${showcaseJson.evalObservations.headPassed} / ${showcaseJson.evalObservations.headTotal}`,
  },
  evalObservationTotal: {
    passed: showcaseJson.evalObservations.basePassed + showcaseJson.evalObservations.headPassed,
    total: showcaseJson.evalObservations.baseTotal + showcaseJson.evalObservations.headTotal,
  },
  featuredMetrics: {
    outputTokens: {
      ...outputTokens,
      baseShort: concise(outputTokens.base),
      headShort: concise(outputTokens.head),
    },
    duration: {
      ...duration,
      baseShort: concise(duration.base),
      headShort: concise(duration.head),
    },
  },
  subagent: {
    ...showcaseJson.subagent,
    base: `${showcaseJson.subagent.baseUsedRuns} / ${showcaseJson.subagent.baseTotalRuns} runs`,
    head: `${showcaseJson.subagent.headUsedRuns} / ${showcaseJson.subagent.headTotalRuns} runs`,
  },
} as const;
