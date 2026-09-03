/**
 * The ONLY file that touches eve invocation and output. Everything else in
 * diff0 consumes the normalized RunRecord (src/types.ts).
 *
 * Contract notes cover the legacy 0.29.5 result shape and the current pinned Eve release:
 * - `eve eval --json --skip-report` prints the EveEvalRunSummary to stdout.
 *   Exit 0 = all passed, 1 = eval failures (still a valid summary), 2 =
 *   config error (no summary). Stdout is parsed defensively with
 *   lastJsonDocument in case the embedded host prints noise.
 * - Skill loads are ordinary tool calls named "load_skill" with input
 *   `{ skill }`.
 * - Tokens/cost exist only per model step in `result.events[]`
 *   (`step.completed.data.usage`); `costUsd` only for AI Gateway models.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentInfo,
  CheckResult,
  EvalResult,
  EveAdapter,
  RunOptions,
  RunRecord,
  SubagentCall,
  ToolCall,
} from "../types.js";
import { lastJsonDocument } from "./last-json-document.js";

/** Thrown by probe() when the target repo has no runnable evals. */
export class NoEvalsError extends Error {
  /** The Eve runner's own message, preserved for the CLI's actionable error. */
  readonly runnerMessage: string;

  constructor(cwd: string, runnerMessage: string) {
    super(`No evals found in ${cwd}. eve said: ${runnerMessage.trim() || "(no output)"}`);
    this.name = "NoEvalsError";
    this.runnerMessage = runnerMessage;
  }
}

/** Thrown when --evals filters select none of the evals discovered by probe(). */
export class EvalFilterNoMatchError extends Error {
  readonly filters: string[];
  readonly availableEvalIds: string[];

  constructor(filters: string[], availableEvalIds: string[]) {
    super(
      `No evals matched --evals ${filters.map((filter) => JSON.stringify(filter)).join(", ")}. ` +
        `Available eval ids: ${availableEvalIds.join(", ")}.`,
    );
    this.name = "EvalFilterNoMatchError";
    this.filters = [...filters];
    this.availableEvalIds = [...availableEvalIds];
  }
}

/** One entry of `eve eval --list --json`. */
export interface EveEvalListing {
  id: string;
  description?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Minimal shapes of the eve --json output we actually consume. Everything is
// optional-tolerant: the mapper must never crash on a missing field.
// ---------------------------------------------------------------------------

interface EveJsonAssertion {
  name?: string;
  score?: number;
  severity?: string;
  passed?: boolean;
  message?: string;
}

interface EveJsonToolCall {
  name?: string;
  input?: unknown;
  status?: string;
  turnIndex?: number;
}

interface EveJsonSubagentCall {
  name?: string;
  turnIndex?: number;
}

interface EveJsonUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

interface EveJsonEvent {
  type?: string;
  data?: {
    modelId?: string;
    stepIndex?: number;
    turnId?: string;
    usage?: EveJsonUsage;
    message?: unknown;
    result?: {
      kind?: string;
      usage?: EveJsonUsage;
      outcome?: { usageDelta?: EveJsonUsage };
    };
  };
}

interface EveJsonRuntimeIdentity {
  eveVersion?: string;
  modelId?: string;
}

interface EveJsonEvalResult {
  id?: string;
  verdict?: string;
  assertions?: EveJsonAssertion[];
  startedAt?: string;
  completedAt?: string;
  result?: {
    output?: unknown;
    finalMessage?: unknown;
    derived?: {
      toolCalls?: EveJsonToolCall[];
      subagentCalls?: EveJsonSubagentCall[];
    };
    events?: EveJsonEvent[];
    runtimeIdentity?: EveJsonRuntimeIdentity;
  };
}

/** The slice of EveEvalRunSummary that the mapper consumes. */
export interface EveEvalRunSummary {
  results?: EveJsonEvalResult[];
  startedAt?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Parent cancellation forwarded to the detached command process group. */
export class CommandInterruptedError extends Error {
  readonly signal: "SIGINT" | "SIGTERM";

  constructor(bin: string, args: string[], signal: "SIGINT" | "SIGTERM") {
    super(`${bin} ${args.join(" ")} interrupted by ${signal}`);
    this.name = "CommandInterruptedError";
    this.signal = signal;
  }
}

const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const DEFAULT_EVAL_SUITE_TIMEOUT_MS = 30 * 60_000;
const EVAL_SUITE_TIMEOUT_OVERHEAD_MS = 2 * 60_000;
const MAX_EVAL_SUITE_TIMEOUT_MS = 12 * 60 * 60_000;
const TERMINATION_GRACE_MS = 2_000;

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function signalProcessTree(childPid: number | undefined, signal: NodeJS.Signals): void {
  if (childPid === undefined) return;
  try {
    if (process.platform === "win32") {
      // Node cannot signal a Windows process group. The direct child still
      // receives the signal; CI's supported Linux/macOS runners get the full
      // process-group behavior below.
      process.kill(childPid, signal);
    } else {
      process.kill(-childPid, signal);
    }
  } catch {
    // ESRCH means the process already exited. `close` remains the single
    // settlement point, so racing exit/timeout cannot double-settle.
  }
}

export function runCommand(
  bin: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminalError: Error | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const terminate = (error: Error): void => {
      if (terminalError !== undefined) return;
      terminalError = error;
      signalProcessTree(child.pid, "SIGTERM");
      killTimer = setTimeout(() => signalProcessTree(child.pid, "SIGKILL"), TERMINATION_GRACE_MS);
      killTimer.unref();
    };
    const capture = (target: "stdout" | "stderr", chunk: string): void => {
      if (terminalError !== undefined) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maxOutputBytes) {
        terminate(
          new Error(
            `${bin} ${args.join(" ")} exceeded the ${maxOutputBytes}-byte combined output limit`,
          ),
        );
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    const onSigint = (): void => {
      terminate(new CommandInterruptedError(bin, args, "SIGINT"));
    };
    const onSigterm = (): void => {
      terminate(new CommandInterruptedError(bin, args, "SIGTERM"));
    };

    // The child owns a detached process group on Unix so timeout and cancellation
    // can terminate every descendant. Forward parent cancellation explicitly;
    // otherwise Ctrl-C would only terminate diff0 and leave the paid eval alive.
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        terminate(new Error(`${bin} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timer.unref();
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      capture("stdout", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      capture("stderr", chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (terminalError !== undefined) {
        // The direct child may exit before one of its descendants. Kill the
        // detached group once more before clearing the grace timer.
        signalProcessTree(child.pid, "SIGKILL");
        cleanup();
        reject(terminalError);
        return;
      }
      cleanup();
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function tail(text: string, chars = 2000): string {
  const trimmed = text.trim();
  return trimmed.length <= chars ? trimmed : `…${trimmed.slice(-chars)}`;
}

/**
 * Path to the TARGET repo's own eve binary — never diff0's copy, so the
 * suite always runs with the exact eve version the agent repo pins.
 */
function eveBinPath(cwd: string): string {
  return join(cwd, "node_modules", ".bin", "eve");
}

function requireEveBin(cwd: string): string {
  const bin = eveBinPath(cwd);
  if (!existsSync(bin)) {
    throw new Error(
      `eve is not installed in ${cwd} (missing node_modules/.bin/eve). ` +
        "Install the repo's dependencies first (e.g. pnpm install / npm install), " +
        "then re-run diff0.",
    );
  }
  return bin;
}

// ---------------------------------------------------------------------------
// Hashing (tool inputs are never stored raw — they may contain secrets)
// ---------------------------------------------------------------------------

/** Deterministic JSON serialization: object keys sorted at every level. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const body = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "null";
}

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
  let stepStartedSeen = false;
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

    const events = entry.result?.events ?? [];
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
        const stepModel = key === null ? undefined : stepModels.get(key);
        if (stepModel !== undefined) usageModels.add(stepModel);
        else if (stepStartedSeen) stepModelAttributionComplete = false;
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
  if (finalOutputs.length > 0) {
    const canonical = stableStringify(finalOutputs);
    record.finalOutput = {
      hash: sha256(canonical),
      length: finalOutputs.reduce((total, item) => total + item.length, 0),
    };
  }
  return record;
}

function nonNegativeUsage(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
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
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return end - start;
}

function reportsNoEvals(stderr: string): boolean {
  return /(?:no eval(?:s| suites?| files?)? found|no eval suites?|found 0 evals?)/i.test(stderr);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export class EveCliAdapter implements EveAdapter {
  /** Probe results cached per cwd so runEvalSuite can reuse the version. */
  private readonly probeCache = new Map<
    string,
    { eveVersion: string; evalIds: string[]; model?: string }
  >();

  async probe(cwd: string): Promise<{ eveVersion: string; evalIds: string[] }> {
    const bin = requireEveBin(cwd);

    const version = await runCommand(bin, ["--version"], { cwd, timeoutMs: 60_000 });
    if (version.code !== 0) {
      throw new Error(
        `\`eve --version\` failed in ${cwd} (exit ${version.code}): ${tail(version.stderr)}`,
      );
    }
    const eveVersion = version.stdout.trim();

    const list = await runCommand(bin, ["eval", "--list", "--json"], {
      cwd,
      timeoutMs: 120_000,
    });
    if (list.code === 2 && reportsNoEvals(list.stderr)) {
      throw new NoEvalsError(cwd, tail(list.stderr));
    }
    if (list.code !== 0) {
      throw new Error(
        `\`eve eval --list --json\` failed in ${cwd} (exit ${list.code}): ${tail(list.stderr)}`,
      );
    }
    const listing = lastJsonDocument(list.stdout);
    if (!Array.isArray(listing)) {
      throw new Error(`Unexpected \`eve eval --list --json\` output in ${cwd}: not an array`);
    }
    const evalIds = (listing as EveEvalListing[])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
    if (evalIds.length === 0) {
      throw new NoEvalsError(cwd, tail(list.stderr));
    }

    const info = await getAgentInfo(cwd);
    const probed = {
      eveVersion,
      evalIds,
      ...(info?.model === null || info?.model === undefined ? {} : { model: info.model }),
    };
    this.probeCache.set(cwd, probed);
    return { eveVersion, evalIds };
  }

  async runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord> {
    const bin = requireEveBin(opts.cwd);
    if (!this.probeCache.has(opts.cwd)) await this.probe(opts.cwd);
    const probe = this.probeCache.get(opts.cwd);
    if (probe === undefined)
      throw new Error(`Internal error: Eve probe state missing for ${opts.cwd}`);

    const expectedEvalIds = filteredEvalIds(probe.evalIds, opts.evalFilter);
    if (opts.evalFilter.length > 0 && expectedEvalIds.length === 0) {
      throw new EvalFilterNoMatchError(opts.evalFilter, probe.evalIds);
    }

    const args = ["eval", "--json", "--skip-report"];
    if (opts.timeoutMs !== undefined) args.push("--timeout", String(opts.timeoutMs));
    if (opts.maxConcurrency !== undefined) {
      args.push("--max-concurrency", String(opts.maxConcurrency));
    }
    args.push(...opts.evalFilter);

    // EVE_TRACES=off: diff0 does not consume traces in v1 — hermetic and
    // faster. User env passes through untouched and is NEVER logged.
    const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env, EVE_TRACES: "off" };
    // Comparability defense: eve silently swaps EVERY authored model for its
    // internal mock when NODE_ENV=test (shouldMockAuthoredRuntimeModels in
    // eve's runtime — same switch as EVE_MOCK_AUTHORED_MODELS=1). Test
    // runners and some CI hosts export NODE_ENV=test, which would invalidate
    // the whole comparison without any visible signal. Drop exactly that
    // value; anyone who truly wants mocked models sets
    // EVE_MOCK_AUTHORED_MODELS=1, which passes through untouched.
    if (env.NODE_ENV === "test") {
      env.NODE_ENV = undefined;
    }

    const evalCount = Math.max(1, expectedEvalIds.length);
    const suiteTimeoutMs = outerSuiteTimeoutMs(opts.timeoutMs, evalCount);
    const run = await runCommand(bin, args, { cwd: opts.cwd, env, timeoutMs: suiteTimeoutMs });

    // 0 = all passed, 1 = eval failures — both are valid RunRecords.
    if (run.code !== 0 && run.code !== 1) {
      throw new Error(
        `\`eve eval --json\` failed in ${opts.cwd} (exit ${run.code}): ${tail(run.stderr)}`,
      );
    }

    let summary: EveEvalRunSummary;
    try {
      summary = lastJsonDocument(run.stdout) as EveEvalRunSummary;
    } catch (error) {
      throw new Error(
        `Could not parse \`eve eval --json\` stdout in ${opts.cwd} (exit ${run.code}): ` +
          `${error instanceof Error ? error.message : String(error)}. stderr: ${tail(run.stderr)}`,
      );
    }

    const fallbackInfo = probe.model === undefined ? await getAgentInfo(opts.cwd) : null;
    const record = summaryToRunRecord(summary, {
      ref,
      commitSha,
      runIndex: opts.runIndex,
      eveVersion: probe.eveVersion,
      ...(probe.model !== undefined
        ? { model: probe.model }
        : fallbackInfo?.model
          ? { model: fallbackInfo.model }
          : {}),
      sandboxBackend: opts.sandboxBackend ?? "unknown",
    });
    const observedEvalIds = record.evalResults.map((result) => result.name);
    const observedCounts = new Map<string, number>();
    for (const id of observedEvalIds) observedCounts.set(id, (observedCounts.get(id) ?? 0) + 1);
    const missing = expectedEvalIds.filter((id) => !observedCounts.has(id));
    const duplicate = [...observedCounts].filter(([, count]) => count > 1).map(([id]) => id);
    const unexpected = [...observedCounts.keys()].filter((id) => !expectedEvalIds.includes(id));
    if (missing.length > 0 || duplicate.length > 0 || unexpected.length > 0) {
      const details = [
        ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
        ...(duplicate.length > 0 ? [`duplicate: ${duplicate.join(", ")}`] : []),
        ...(unexpected.length > 0 ? [`unexpected: ${unexpected.join(", ")}`] : []),
      ];
      throw new Error(
        `\`eve eval --json\` returned an incomplete or inconsistent eval result set in ` +
          `${opts.cwd} (${details.join("; ")}). Expected every selected eval exactly once.`,
      );
    }
    return record;
  }
}

function filteredEvalIds(evalIds: string[], filters: string[]): string[] {
  if (filters.length === 0) return evalIds;
  return evalIds.filter((id) => filters.some((filter) => id === filter || id.startsWith(filter)));
}

export function outerSuiteTimeoutMs(
  perEvalTimeoutMs: number | undefined,
  evalCount: number,
): number {
  if (perEvalTimeoutMs === undefined) return DEFAULT_EVAL_SUITE_TIMEOUT_MS;
  const safeCount = Math.max(1, evalCount);
  return Math.min(
    MAX_EVAL_SUITE_TIMEOUT_MS,
    perEvalTimeoutMs * safeCount + EVAL_SUITE_TIMEOUT_OVERHEAD_MS,
  );
}

/**
 * Structural agent surface from `eve info --json`.
 * Tolerates every failure by returning null — the surface diff is optional
 * enrichment, never a reason to fail a comparison.
 */
export async function getAgentInfo(cwd: string): Promise<AgentInfo | null> {
  try {
    const bin = requireEveBin(cwd);
    const info = await runCommand(bin, ["info", "--json"], { cwd, timeoutMs: 120_000 });
    if (info.code !== 0) return null;
    // Some Eve releases print a banner before the JSON; lastJsonDocument handles it.
    const parsed = lastJsonDocument(info.stdout) as {
      model?: unknown;
      skills?: unknown;
      tools?: unknown;
      subagents?: unknown;
    };
    return {
      model: typeof parsed.model === "string" ? parsed.model : null,
      skills: stringArray(parsed.skills),
      tools: stringArray(parsed.tools),
      subagents: stringArray(parsed.subagents),
    };
  } catch (error) {
    // Optional metadata failures are tolerated, but user/CI cancellation must
    // still unwind the comparison and release its worktrees.
    if (error instanceof CommandInterruptedError) throw error;
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
