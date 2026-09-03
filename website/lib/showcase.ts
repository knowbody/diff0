import showcaseJson from "@/content/showcase.json";

const titleCaseModel = showcaseJson.model
  .split("/")
  .at(-1)
  ?.split("-")
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(" ");

if (!titleCaseModel) throw new Error("Showcase data is missing a model identity.");

export const showcase = {
  ...showcaseJson,
  modelDisplay: titleCaseModel,
  evalPasses: {
    base: `${showcaseJson.evalObservations.basePassed} / ${showcaseJson.evalObservations.baseTotal}`,
    head: `${showcaseJson.evalObservations.headPassed} / ${showcaseJson.evalObservations.headTotal}`,
  },
  subagent: {
    ...showcaseJson.subagent,
    base: `${showcaseJson.subagent.baseUsedRuns} / ${showcaseJson.subagent.baseTotalRuns} runs`,
    head: `${showcaseJson.subagent.headUsedRuns} / ${showcaseJson.subagent.headTotalRuns} runs`,
  },
} as const;
