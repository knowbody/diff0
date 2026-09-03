/**
 * Terse RunRecord fixture builders for analysis/report tests.
 *
 * buildRuns("main", "aaa1111", [
 *   { evals: { "weather/forecast": true }, tools: ["get_weather", "done"], skills: ["units"] },
 * ])
 */
import type { CheckResult, EvalResult, RunRecord, SandboxBackend } from "../../src/types.js";

export type EvalSpec =
  | boolean
  | {
      passed: boolean;
      /** Soft/scored check values in [0,1]; each becomes a scored CheckResult. */
      scores?: number[];
      /** Explicit checks for scorer-identity and mixed assertion fixtures. */
      checks?: CheckResult[];
    };

export interface RunSpec {
  evals?: Record<string, EvalSpec>;
  /** Tool names in call order. */
  tools?: string[];
  /** Tool calls with explicit privacy-preserving input hashes. Takes precedence over tools. */
  toolInputs?: Array<{ name: string; inputsHash: string; evalName?: string }>;
  skills?: string[];
  skillLoads?: Array<{ name: string; evalName?: string }>;
  subagents?: string[];
  subagentCalls?: Array<{ name: string; evalName?: string }>;
  costUsd?: number | null;
  durationMs?: number;
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  model?: string;
  eveVersion?: string;
  sandboxBackend?: SandboxBackend;
  dataSources?: { evalJson: boolean; spans: boolean; logs: boolean };
  finalOutput?: { hash: string; length?: number };
  finalOutputs?: Record<string, { hash: string; length?: number }>;
}

const DEFAULTS = {
  model: "mock-model",
  eveVersion: "0.29.5",
  sandboxBackend: "docker" as SandboxBackend,
  costUsd: 0.03,
  durationMs: 12000,
  tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
  dataSources: { evalJson: true, spans: false, logs: false },
};

function toEvalResult(name: string, spec: EvalSpec): EvalResult {
  const passed = typeof spec === "boolean" ? spec : spec.passed;
  const scores = typeof spec === "boolean" ? undefined : spec.scores;
  const explicitChecks = typeof spec === "boolean" ? undefined : spec.checks;
  const checks: CheckResult[] =
    explicitChecks ??
    (scores
      ? scores.map((score, i) => ({ name: `check-${i}`, passed: score >= 0.5, score }))
      : [{ name: "check-0", passed }]);
  return { name, passed, checks, durationMs: 1000 };
}

export function buildRun(ref: string, commitSha: string, runIndex: number, spec: RunSpec = {}): RunRecord {
  const tools = spec.tools ?? [];
  const subagents = spec.subagents ?? [];
  const evalResults = Object.entries(spec.evals ?? {}).map(([name, evalSpec]) => {
    const result = toEvalResult(name, evalSpec);
    const output = spec.finalOutputs?.[name];
    if (output) result.finalOutput = output;
    return result;
  });
  if (spec.finalOutput && evalResults[0]) evalResults[0].finalOutput = spec.finalOutput;
  return {
    ref,
    commitSha,
    runIndex,
    evalResults,
    toolCalls: spec.toolInputs
      ? spec.toolInputs.map((call, order) => ({ ...call, order }))
      : tools.map((name, order) => ({ name, order, inputsHash: `hash-${order}` })),
    skillLoads: spec.skillLoads ?? (spec.skills ?? []).map((name) => ({ name })),
    skillsLoaded: spec.skills ?? [...new Set((spec.skillLoads ?? []).map((load) => load.name))],
    subagentCalls: spec.subagentCalls
      ? spec.subagentCalls.map((call, order) => ({ ...call, order }))
      : subagents.map((name, order) => ({ name, order })),
    ...(spec.finalOutput ? { finalOutput: spec.finalOutput } : {}),
    tokens: spec.tokens
      ? {
          input: spec.tokens.input,
          output: spec.tokens.output,
          cacheRead: spec.tokens.cacheRead ?? 0,
          cacheWrite: spec.tokens.cacheWrite ?? 0,
        }
      : DEFAULTS.tokens,
    costUsd: spec.costUsd === undefined ? DEFAULTS.costUsd : spec.costUsd,
    durationMs: spec.durationMs ?? DEFAULTS.durationMs,
    sandboxBackend: spec.sandboxBackend ?? DEFAULTS.sandboxBackend,
    model: spec.model ?? DEFAULTS.model,
    pricingModel: spec.model ?? DEFAULTS.model,
    eveVersion: spec.eveVersion ?? DEFAULTS.eveVersion,
    dataSources: spec.dataSources ?? DEFAULTS.dataSources,
    startedAt: "2026-08-03T10:00:00.000Z",
  };
}

export function buildRuns(ref: string, commitSha: string, specs: RunSpec[]): RunRecord[] {
  return specs.map((spec, i) => buildRun(ref, commitSha, i, spec));
}

/** N runs with identical spec — the common "consistent ref" case. */
export function repeatRuns(ref: string, commitSha: string, n: number, spec: RunSpec = {}): RunRecord[] {
  return buildRuns(ref, commitSha, Array.from({ length: n }, () => spec));
}

/** Fixed timestamp so DeltaReport output is snapshot-stable. */
export const FIXED_NOW = "2026-08-03T12:00:00.000Z";
