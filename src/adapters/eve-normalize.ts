import { createHash } from "node:crypto";
import { stableStringify } from "../serialization.js";
import type { CheckResult, EvalResult, RunRecord, SubagentCall, ToolCall } from "../types.js";
import type { EveEvalRunSummary, EveJsonEvalResult } from "./eve-json.js";
import { collectEvalUsage } from "./eve-usage.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Summary -> RunRecord mapping (pure; unit-tested against a synthetic fixture)
// ---------------------------------------------------------------------------

export interface SummaryContext {
  ref: string;
  commitSha: string;
  runIndex: number;
  /** Fallback eve version (from probe) when runtimeIdentity is absent. */
  eveVersion: string;
  /** Fallback model from `eve info --json` for Eve versions that omit modelId. */
  model?: string;
  sandboxBackend: RunRecord["sandboxBackend"];
}

export function summaryToRunRecord(summary: EveEvalRunSummary, ctx: SummaryContext): RunRecord {
  const results = summary.results ?? [];

  const evalResults: EvalResult[] = [];
  const toolCalls: ToolCall[] = [];
  const subagentCalls: SubagentCall[] = [];
  const skillLoads: RunRecord["skillLoads"] = [];
  const skillsLoaded: string[] = [];
  let toolOrder = 0;
  let subagentOrder = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costSum = 0;
  let costSeen = false;
  let gatewayCostComplete = true;
  let unpricedSubagentUsageSeen = false;
  let stepModelAttributionComplete = true;
  let model: string | undefined;
  const observedModels = new Set<string>();
  const usageModels = new Set<string>();
  let eveVersion: string | undefined;
  const finalOutputs: Array<{ evalName: string; hash: string; length: number }> = [];

  for (const entry of results) {
    const evalName = entry.id ?? "unknown";

    const checks: CheckResult[] = (entry.assertions ?? []).map((assertion) => {
      const check: CheckResult = {
        name: assertion.name ?? "unknown",
        passed: assertion.passed === true,
      };
      if (typeof assertion.score === "number") check.score = assertion.score;
      return check;
    });

    const evalResult: EvalResult = {
      name: evalName,
      passed: entry.verdict === "passed",
      checks,
    };
    const evalDuration = isoSpanMs(entry.startedAt, entry.completedAt);
    if (evalDuration !== undefined) evalResult.durationMs = evalDuration;
    evalResults.push(evalResult);

    const finalOutput = normalizedFinalOutput(entry);
    if (finalOutput !== undefined) {
      const fingerprint = {
        evalName,
        hash: sha256(finalOutput),
        length: finalOutput.length,
      };
      evalResult.finalOutput = { hash: fingerprint.hash, length: fingerprint.length };
      finalOutputs.push(fingerprint);
    } else if (entry.result?.finalMessage === null && entry.result.output == null) {
      // An explicit null is evidence of no final message, not a missing artifact.
      evalResult.finalOutputAbsent = true;
    }

    // Global tool-call sequence: results[] order, then turnIndex, then array
    // order within the same turn (Array.prototype.sort is stable).
    const rawToolCalls = entry.result?.derived?.toolCalls ?? [];
    const orderedToolCalls = rawToolCalls
      .map((call, index) => ({ call, index }))
      .sort((a, b) => (a.call.turnIndex ?? 0) - (b.call.turnIndex ?? 0) || a.index - b.index);
    for (const { call } of orderedToolCalls) {
      const name = call.name ?? "unknown";
      toolCalls.push({
        name,
        order: toolOrder++,
        inputsHash: sha256(stableStringify(call.input ?? null)),
        evalName,
      });
      if (name === "load_skill") {
        const input = call.input as { skill?: unknown } | undefined;
        const skill = typeof input?.skill === "string" ? input.skill : undefined;
        if (skill !== undefined && !skillsLoaded.includes(skill)) {
          skillsLoaded.push(skill);
        }
        if (skill !== undefined) {
          skillLoads.push({ name: skill, evalName });
        }
      }
    }

    const rawSubagentCalls = entry.result?.derived?.subagentCalls ?? [];
    const orderedSubagentCalls = rawSubagentCalls
      .map((call, index) => ({ call, index }))
      .sort((a, b) => (a.call.turnIndex ?? 0) - (b.call.turnIndex ?? 0) || a.index - b.index);
    for (const { call } of orderedSubagentCalls) {
      subagentCalls.push({
        name: call.name ?? "unknown",
        order: subagentOrder++,
        evalName,
      });
    }

    const usage = collectEvalUsage(
      entry.result?.events ?? [],
      entry.result?.runtimeIdentity?.modelId ?? ctx.model,
    );
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheReadTokens += usage.cacheReadTokens;
    cacheWriteTokens += usage.cacheWriteTokens;
    costSum += usage.costSum;
    costSeen ||= usage.costSeen;
    gatewayCostComplete &&= usage.gatewayCostComplete;
    unpricedSubagentUsageSeen ||= usage.unpricedSubagentUsageSeen;
    stepModelAttributionComplete &&= usage.stepModelAttributionComplete;
    for (const modelId of usage.usageModels) usageModels.add(modelId);

    const identity = entry.result?.runtimeIdentity;
    if (model === undefined && typeof identity?.modelId === "string") {
      model = identity.modelId;
    }
    if (typeof identity?.modelId === "string") observedModels.add(identity.modelId);
    if (eveVersion === undefined && typeof identity?.eveVersion === "string") {
      eveVersion = identity.eveVersion;
    }
  }

  const reportedModel =
    usageModels.size > 0 ? [...usageModels].sort().join(" / ") : (model ?? ctx.model ?? "unknown");
  const record: RunRecord = {
    ref: ctx.ref,
    commitSha: ctx.commitSha,
    runIndex: ctx.runIndex,
    evalResults,
    toolCalls,
    skillLoads,
    skillsLoaded,
    subagentCalls,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
    },
    costUsd: costSeen && gatewayCostComplete && !unpricedSubagentUsageSeen ? costSum : null,
    durationMs: isoSpanMs(summary.startedAt, summary.completedAt) ?? 0,
    sandboxBackend: ctx.sandboxBackend,
    model: reportedModel,
    pricingModel: (() => {
      if (unpricedSubagentUsageSeen || !stepModelAttributionComplete) return null;
      const pricingModels = usageModels.size > 0 ? usageModels : observedModels;
      if (pricingModels.size > 1) return null;
      return pricingModels.values().next().value ?? model ?? ctx.model ?? "unknown";
    })(),
    eveVersion: eveVersion ?? ctx.eveVersion,
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: summary.startedAt ?? new Date(0).toISOString(),
  };
  // Eve emits step cost only when gateway metadata supplies it; an explicit zero
  // is measured, unlike a legacy caller's zero without provenance.
  if (record.costUsd !== null) record.costSource = "gateway";
  if (finalOutputs.length > 0) {
    const canonical = stableStringify(finalOutputs);
    record.finalOutput = {
      hash: sha256(canonical),
      length: finalOutputs.reduce((total, item) => total + item.length, 0),
    };
  }
  return record;
}

function normalizedFinalOutput(entry: EveJsonEvalResult): string | undefined {
  const direct = entry.result?.finalMessage ?? entry.result?.output;
  if (typeof direct === "string") return direct.normalize("NFC");
  if (direct !== undefined && direct !== null) return stableStringify(direct);

  const completedMessages = (entry.result?.events ?? [])
    .filter((event) => event.type === "message.completed")
    .map((event) => event.data?.message)
    .filter(
      (message): message is NonNullable<typeof message> =>
        message !== undefined && message !== null,
    );
  if (completedMessages.length === 0) return undefined;
  const last = completedMessages.at(-1);
  return typeof last === "string" ? last.normalize("NFC") : stableStringify(last);
}

function isoSpanMs(startedAt?: string, completedAt?: string): number | undefined {
  if (startedAt === undefined || completedAt === undefined) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}
