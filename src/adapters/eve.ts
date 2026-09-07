/**
 * Eve CLI discovery and invocation. Adapter-local normalization produces the
 * RunRecord contract consumed by the analysis and harness.
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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigurationError } from "../errors.js";
import { CommandInterruptedError, runCommand } from "../execution.js";
import type { AgentInfo, EveAdapter, RunOptions, RunRecord } from "../types.js";
import {
  type EveEvalRunSummary,
  parseAgentInfo,
  parseEveListing,
  parseEveSummary,
} from "./eve-json.js";
import { summaryToRunRecord } from "./eve-normalize.js";
import { lastJsonDocument } from "./last-json-document.js";

// Compatibility exports for existing adapter consumers.
export { CommandInterruptedError, type RunCommandOptions, runCommand } from "../execution.js";
export { stableStringify } from "../serialization.js";
export type { EveEvalRunSummary } from "./eve-json.js";
export { type SummaryContext, summaryToRunRecord } from "./eve-normalize.js";

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
// Eve command bounds
// ---------------------------------------------------------------------------

const DEFAULT_EVAL_SUITE_TIMEOUT_MS = 30 * 60_000;
const EVAL_SUITE_TIMEOUT_OVERHEAD_MS = 2 * 60_000;
const MAX_EVAL_SUITE_TIMEOUT_MS = 12 * 60 * 60_000;

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
    throw new ConfigurationError(
      `eve is not installed in ${cwd} (missing node_modules/.bin/eve). ` +
        "Install the repo's dependencies first (e.g. pnpm install / npm install), " +
        "then re-run diff0.",
    );
  }
  return bin;
}

// ---------------------------------------------------------------------------
// CLI diagnostics
// ---------------------------------------------------------------------------

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

  async probe(
    cwd: string,
  ): Promise<{ eveVersion: string; evalIds: string[]; agentInfo: AgentInfo | null }> {
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
    const evalIds = parseEveListing(lastJsonDocument(list.stdout)).map((item) => item.id);
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
    return { eveVersion, evalIds, agentInfo: info };
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
      summary = parseEveSummary(lastJsonDocument(run.stdout));
    } catch (error) {
      throw new Error(
        `Could not parse \`eve eval --json\` stdout in ${opts.cwd} (exit ${run.code}): ` +
          `${error instanceof Error ? error.message : String(error)}. stderr: ${tail(run.stderr)}`,
      );
    }

    const record = summaryToRunRecord(summary, {
      ref,
      commitSha,
      runIndex: opts.runIndex,
      eveVersion: probe.eveVersion,
      ...(probe.model !== undefined ? { model: probe.model } : {}),
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
    return parseAgentInfo(lastJsonDocument(info.stdout));
  } catch (error) {
    // Optional metadata failures are tolerated, but user/CI cancellation must
    // still unwind the comparison and release its worktrees.
    if (error instanceof CommandInterruptedError) throw error;
    return null;
  }
}
