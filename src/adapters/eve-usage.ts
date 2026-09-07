import type { EveJsonEvent } from "./eve-json.js";

/** Per-eval accounting: root steps own gateway cost; delegated usage has no price identity. */
export function collectEvalUsage(events: EveJsonEvent[], legacyModel?: string) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costSum = 0;
  let costSeen = false;
  let gatewayCostComplete = true;
  let unpricedSubagentUsageSeen = false;
  let stepStartedSeen = false;
  let stepModelAttributionComplete = true;
  const usageModels = new Set<string>();
  const stepModels = new Map<string, string>();
  const stepKey = (event: EveJsonEvent) =>
    typeof event.data?.turnId === "string" && typeof event.data.stepIndex === "number"
      ? `${event.data.turnId}\u0000${event.data.stepIndex}`
      : null;
  for (const event of events) {
    if (event.type !== "step.started" || typeof event.data?.modelId !== "string") continue;
    stepStartedSeen = true;
    const key = stepKey(event);
    if (key !== null) stepModels.set(key, event.data.modelId);
  }
  for (const event of events) {
    if (event.type === "step.completed") {
      const usage = event.data?.usage;
      if (usage === undefined) continue;
      const key = stepKey(event);
      // Legacy summaries have no step identity; their own eval model is the only
      // available attribution. Never borrow another eval's observed step model.
      const stepModel =
        (key === null ? undefined : stepModels.get(key)) ??
        (!stepStartedSeen ? legacyModel : undefined);
      if (stepModel !== undefined) usageModels.add(stepModel);
      else stepModelAttributionComplete = false;
      const cacheRead = nonNegativeUsage(usage.cacheReadTokens);
      const cacheWrite = nonNegativeUsage(usage.cacheWriteTokens);
      inputTokens += Math.max(0, nonNegativeUsage(usage.inputTokens) - cacheRead - cacheWrite);
      outputTokens += nonNegativeUsage(usage.outputTokens);
      cacheReadTokens += cacheRead;
      cacheWriteTokens += cacheWrite;
      if (
        typeof usage.costUsd === "number" &&
        Number.isFinite(usage.costUsd) &&
        usage.costUsd >= 0
      ) {
        costSum += usage.costUsd;
        costSeen = true;
      } else {
        gatewayCostComplete = false;
      }
      continue;
    }
    if (event.type === "action.result" && event.data?.result?.kind === "subagent-result") {
      // Current Eve reports delegated child usage on the action result. Prefer `usage` and
      // fall back to the lifecycle outcome delta; they describe the same child turn and must
      // never be added together.
      const usage = event.data.result.usage ?? event.data.result.outcome?.usageDelta;
      if (usage === undefined) continue;
      const childInput = nonNegativeUsage(usage.inputTokens);
      const childOutput = nonNegativeUsage(usage.outputTokens);
      const childCacheRead = nonNegativeUsage(usage.cacheReadTokens);
      const childCacheWrite = nonNegativeUsage(usage.cacheWriteTokens);
      inputTokens += Math.max(0, childInput - childCacheRead - childCacheWrite);
      outputTokens += childOutput;
      cacheReadTokens += childCacheRead;
      cacheWriteTokens += childCacheWrite;
      if (childInput + childOutput + childCacheRead + childCacheWrite > 0) {
        // The event has no child model/cost identity. A partial root-only gateway total would
        // be misleading, so force the pricing layer to produce an explicit estimate or mark
        // cost unavailable for this run.
        unpricedSubagentUsageSeen = true;
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costSum,
    costSeen,
    gatewayCostComplete,
    unpricedSubagentUsageSeen,
    stepModelAttributionComplete,
    usageModels,
  };
}

function nonNegativeUsage(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
