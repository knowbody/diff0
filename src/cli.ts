#!/usr/bin/env node
/**
 * `diff0` CLI — thin by design: flag parsing, wiring, exit codes.
 * The interface is docs/cli-contract.md; all logic lives in the modules
 * (harness/runner, harness/estimate, collect/pricing, analyze/delta,
 * report/*).
 *
 * Exit codes (per contract):
 *   0 ran to completion, fail-on policy satisfied
 *   1 fail-on policy violated (red; or yellow under --fail-on drift)
 *   2 usage/config error (bad flags, unknown ref, not a repo, no evals,
 *     eve not installed in target)
 *   3 execution error (eval run crashed, install/worktree failure)
 *   4 --max-spend exceeded (run: measured mid-comparison; estimate: projected)
 */

import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { CommandInterruptedError, EvalFilterNoMatchError, NoEvalsError } from "./adapters/eve.js";
import { type ComputeDeltaOptions, computeDelta } from "./analyze/delta.js";
import { getDiff0Version } from "./collect/cache.js";
import { applyPricing } from "./collect/pricing.js";
import { type Estimate, type EstimateOptions, runEstimate } from "./harness/estimate.js";
import { getDiffStat } from "./harness/gitdiff.js";
import {
  EvalRunError,
  MaxSpendExceededError,
  type RunComparisonOptions,
  runComparison,
} from "./harness/runner.js";
import type { InferredSandboxBackend } from "./harness/sandbox.js";
import type { CreateWorktreeOptions, WorktreeHandle } from "./harness/worktree.js";
import { formatDuration, formatUsd, shortSha } from "./report/format.js";
import { renderJson } from "./report/json.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderNoEvalsHelp } from "./report/teach.js";
import { renderTerminal } from "./report/terminal.js";
import type { AgentInfo, DependencyInstallMode, EveAdapter } from "./types.js";

declare const DIFF0_ACTION_BUNDLE: boolean | undefined;

interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

/**
 * Test-only dependency seams threaded through to the harness (fake adapter,
 * fake worktrees, ...) so CLI-level behavior — exit codes, stderr wording —
 * is testable without eve or real worktrees. Production callers omit this.
 */
export interface CliHarnessSeams {
  adapter?: EveAdapter;
  createWorktree?: (
    repoPath: string,
    ref: string,
    opts?: CreateWorktreeOptions,
  ) => Promise<WorktreeHandle>;
  inferSandbox?: () => Promise<InferredSandboxBackend>;
  getAgentInfo?: (cwd: string) => Promise<AgentInfo | null>;
  resolveRef?: NonNullable<RunComparisonOptions["resolveRef"]>;
  readCache?: NonNullable<RunComparisonOptions["readCache"]>;
  writeCache?: NonNullable<RunComparisonOptions["writeCache"]>;
}

type InstallModeInput = DependencyInstallMode | "safe" | "trusted";

interface RunFlags {
  base: string;
  head: string;
  repo: string;
  appDir: string;
  runs: number;
  evals: string[];
  installMode: InstallModeInput;
  timeout?: number;
  maxConcurrency?: number;
  maxSpend?: number;
  reportMd?: string;
  reportJson?: string;
  json: boolean;
  /** Base-ref cache is opt-in because external state cannot be represented in its key. */
  cache: boolean;
  failOn: "regression" | "drift" | "never";
  /** Commander's --no-color: true by default, false when the flag is given. */
  color: boolean;
}

interface EstimateFlags {
  base: string;
  head: string;
  repo: string;
  appDir: string;
  runs: number;
  evals: string[];
  installMode: InstallModeInput;
  maxSpend?: number;
}

function parsePositiveInt(label: string) {
  return (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!/^\d+$/.test(value.trim()) || Number.isNaN(parsed) || parsed < 1) {
      throw new InvalidArgumentError(`${label} must be a positive integer (got "${value}")`);
    }
    return parsed;
  };
}

function parseUsd(label: string) {
  return (value: string): number => {
    const normalized = value.trim();
    const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
    const parsed = Number(normalized);
    if (!decimal.test(normalized) || !Number.isFinite(parsed) || parsed <= 0) {
      throw new InvalidArgumentError(`${label} must be a positive USD amount (got "${value}")`);
    }
    return parsed;
  };
}

/** Repeatable and comma-separated: --evals a,b --evals c -> ["a","b","c"]. */
function collectEvalFilter(value: string, previous: string[]): string[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new InvalidArgumentError(`evals must include at least one non-empty filter`);
  }
  return [...previous, ...parts];
}

function useColor(flags: RunFlags): boolean {
  if (!flags.color) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return process.stdout.isTTY === true;
}

function normalizeInstallMode(mode: InstallModeInput, io: CliIo): DependencyInstallMode {
  if (mode === "safe" || mode === "trusted") {
    const replacement = mode === "safe" ? "scripts-off" : "scripts-on";
    io.err(`warning: --install-mode ${mode} is deprecated; use ${replacement}\n`);
    return replacement;
  }
  return mode;
}

function exitCodeForError(error: unknown): 2 | 3 | 4 {
  if (error instanceof MaxSpendExceededError) return 4;
  if (error instanceof EvalFilterNoMatchError) return 2;
  if (error instanceof NoEvalsError) return 2;
  if (error instanceof EvalRunError) return 3;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /is not a git repository/i.test(message) ||
    /was not found in/i.test(message) ||
    /eve is not installed/i.test(message) ||
    /working tree has uncommitted changes/i.test(message) ||
    /runs must be a positive integer/i.test(message)
  ) {
    return 2;
  }
  return 3;
}

/**
 * Shared error rendering for run + estimate: the no-evals case gets the full
 * teaching message (minimal example suite + docs link); everything else gets
 * the one-line `diff0: ...` prefix. Returns the mapped exit code.
 */
function reportCliError(error: unknown, io: CliIo, appPath: string): number {
  if (error instanceof NoEvalsError) {
    io.err(renderNoEvalsHelp(appPath, error));
    return 2;
  }
  if (error instanceof CommandInterruptedError) {
    io.err(`diff0: interrupted by ${error.signal}\n`);
    return error.signal === "SIGINT" ? 130 : 143;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.err(`diff0: ${message}\n`);
  return exitCodeForError(error);
}

async function writeReportFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), content, "utf8");
}

function applySeams(
  target: Pick<
    RunComparisonOptions,
    | "adapter"
    | "createWorktree"
    | "inferSandbox"
    | "getAgentInfo"
    | "resolveRef"
    | "readCache"
    | "writeCache"
  >,
  seams: CliHarnessSeams | undefined,
): void {
  if (seams === undefined) return;
  if (seams.adapter !== undefined) target.adapter = seams.adapter;
  if (seams.createWorktree !== undefined) target.createWorktree = seams.createWorktree;
  if (seams.inferSandbox !== undefined) target.inferSandbox = seams.inferSandbox;
  if (seams.getAgentInfo !== undefined) target.getAgentInfo = seams.getAgentInfo;
  if (seams.resolveRef !== undefined) target.resolveRef = seams.resolveRef;
  if (seams.readCache !== undefined) target.readCache = seams.readCache;
  if (seams.writeCache !== undefined) target.writeCache = seams.writeCache;
}

async function executeRun(flags: RunFlags, io: CliIo, seams?: CliHarnessSeams): Promise<number> {
  const repoPath = resolve(flags.repo);
  try {
    const installMode = normalizeInstallMode(flags.installMode, io);
    const comparisonOptions: RunComparisonOptions = {
      repoPath,
      appDir: flags.appDir,
      baseRef: flags.base,
      headRef: flags.head,
      runs: flags.runs,
      evalFilter: flags.evals,
      installMode,
      onProgress: (message) => io.err(`${message}\n`),
    };
    if (flags.timeout !== undefined) comparisonOptions.timeoutMs = flags.timeout;
    if (flags.maxConcurrency !== undefined) {
      comparisonOptions.maxConcurrency = flags.maxConcurrency;
    }
    if (flags.maxSpend !== undefined) comparisonOptions.maxSpendUsd = flags.maxSpend;
    if (!flags.cache) comparisonOptions.noCache = true;
    applySeams(comparisonOptions, seams);

    const { baseRuns, headRuns, meta } = await runComparison(comparisonOptions);

    // One pricing pass over ALL records so the comparison gets a single,
    // coherent cost-source label; order is preserved, so split by count.
    const priced = applyPricing([...baseRuns, ...headRuns]);
    const basePriced = priced.records.slice(0, baseRuns.length);
    const headPriced = priced.records.slice(baseRuns.length);

    const gitDiffStat = await getDiffStat(repoPath, meta.baseSha, meta.headSha);

    const deltaOptions: ComputeDeltaOptions = {
      sandboxInferred: meta.sandboxInferred,
      gitDiffStat,
      baseCacheHit: meta.baseCacheHit,
      validityMismatches: meta.validityMismatches,
    };
    if (priced.costSource !== "unavailable") deltaOptions.costSource = priced.costSource;

    const report = computeDelta(basePriced, headPriced, deltaOptions);

    if (flags.reportMd !== undefined) {
      await writeReportFile(flags.reportMd, renderMarkdown(report));
      io.err(`wrote markdown report: ${resolve(flags.reportMd)}\n`);
    }
    if (flags.reportJson !== undefined) {
      await writeReportFile(flags.reportJson, renderJson(report));
      io.err(`wrote JSON report: ${resolve(flags.reportJson)}\n`);
    }

    if (flags.json) {
      io.out(renderJson(report));
    } else {
      io.out(renderTerminal(report, { color: useColor(flags) }));
    }

    if (flags.failOn === "never") return 0;
    if (report.verdict === "red") return 1;
    if (report.verdict === "yellow" && flags.failOn === "drift") return 1;
    return 0;
  } catch (error) {
    return reportCliError(error, io, resolve(repoPath, flags.appDir));
  }
}

/** Human-scale duration for projections: "42.0s", "4m 12s", "1h 05m". */
function formatLongDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return formatDuration(ms);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function renderEstimate(estimate: Estimate): string {
  const lines: string[] = [];
  lines.push(
    `diff0 estimate: ${estimate.baseRef}...${estimate.headRef} ` +
      `(${estimate.runsPerRef} runs per ref planned)`,
  );
  lines.push("");
  if (estimate.sampleSource === "base-cache") {
    lines.push(
      `  sample:          ${estimate.sampleRuns} cached base runs ` +
        `(${estimate.baseRef} @ ${shortSha(estimate.baseSha)}) — no eval run spent`,
    );
  } else {
    lines.push(
      `  sample:          1 fresh suite run on head ` +
        `(${estimate.headRef} @ ${shortSha(estimate.headSha)})`,
    );
  }
  lines.push(`  evals per run:   ${estimate.evalsPerRun}`);
  if (estimate.perRunCostUsd !== null) {
    lines.push(`  cost per run:    ${formatUsd(estimate.perRunCostUsd)} (${estimate.costSource})`);
  } else {
    lines.push(
      `  cost per run:    unavailable — model ${estimate.model} is not in prices.json ` +
        "and eve reported no gateway cost;",
    );
    lines.push("                   the comparison will run but report cost as unavailable");
  }
  lines.push(`  time per run:    ${formatDuration(estimate.perRunDurationMs)}`);
  const runsBreakdown =
    estimate.cachedBaseRuns > 0
      ? `${estimate.chargeableRuns} (head only — ${estimate.cachedBaseRuns} base runs already cached)`
      : `${estimate.chargeableRuns} (${estimate.runsPerRef} per ref x 2 refs)`;
  lines.push(`  projected runs:  ${runsBreakdown}`);
  lines.push(
    `  projected cost:  ${
      estimate.projectedCostUsd !== null ? formatUsd(estimate.projectedCostUsd) : "unavailable"
    }`,
  );
  lines.push(`  projected time:  ~${formatLongDuration(estimate.projectedDurationMs)}`);
  lines.push("");
  const sampledOn = estimate.sampleSource === "base-cache" ? "base" : "head";
  lines.push(
    `Measured on ${sampledOn} only — base and head may genuinely differ in cost and duration.`,
  );
  return `${lines.join("\n")}\n`;
}

async function executeEstimate(
  flags: EstimateFlags,
  io: CliIo,
  seams?: CliHarnessSeams,
): Promise<number> {
  const repoPath = resolve(flags.repo);
  try {
    const installMode = normalizeInstallMode(flags.installMode, io);
    const estimateOptions: EstimateOptions = {
      repoPath,
      appDir: flags.appDir,
      baseRef: flags.base,
      headRef: flags.head,
      runs: flags.runs,
      evalFilter: flags.evals,
      installMode,
      onProgress: (message) => io.err(`${message}\n`),
    };
    applySeams(estimateOptions, seams);

    const estimate = await runEstimate(estimateOptions);
    io.out(renderEstimate(estimate));

    if (flags.maxSpend !== undefined) {
      if (estimate.projectedCostUsd === null) {
        io.err(
          "diff0: cost is unmeasurable for this suite, so --max-spend " +
            `${formatUsd(flags.maxSpend)} cannot be enforced ahead of time. ` +
            "`diff0 run --max-spend` still enforces the cap at run time on " +
            "any cost that becomes measurable.\n",
        );
        return 0;
      }
      if (estimate.projectedCostUsd > flags.maxSpend) {
        io.err(
          `diff0: projected cost ${formatUsd(estimate.projectedCostUsd)} exceeds ` +
            `--max-spend ${formatUsd(flags.maxSpend)}. Lower --runs, narrow --evals, ` +
            "or raise the cap.\n",
        );
        return 4;
      }
      io.err(
        `projected cost ${formatUsd(estimate.projectedCostUsd)} is within --max-spend ` +
          `${formatUsd(flags.maxSpend)}\n`,
      );
    }
    return 0;
  } catch (error) {
    return reportCliError(error, io, resolve(repoPath, flags.appDir));
  }
}

function buildProgram(io: CliIo, onExit: (code: number) => void, seams?: CliHarnessSeams): Command {
  const program = new Command();
  program
    .name("diff0")
    .version(getDiff0Version())
    .description(
      "git diff tells you what changed in the code. " +
        "diff0 tells you what changed in the agent.",
    )
    .exitOverride()
    .configureOutput({
      writeOut: (str) => io.out(str),
      writeErr: (str) => io.err(str),
    });

  program
    .command("run")
    .description("behaviorally diff an eve agent between two git refs")
    .requiredOption("--base <ref>", "base git ref (e.g. main, origin/main, a SHA)")
    .option("--head <ref>", "head git ref", "HEAD")
    .option("--repo <path>", "target repo (a git repo with an eve app + evals)", ".")
    .option("--app-dir <path>", "path of the eve app within the repo", ".")
    .addOption(
      new Option(
        "--install-mode <mode>",
        "dependency install policy: scripts-off disables lifecycle/build scripts; scripts-on " +
          "enables repository-controlled scripts and MUST only be used for refs you trust " +
          "(neither mode is a sandbox)",
      )
        .choices(["scripts-off", "scripts-on", "safe", "trusted"])
        .default("scripts-off"),
    )
    .option("--runs <n>", "eval-suite executions per ref", parsePositiveInt("--runs"), 3)
    .option(
      "--evals <filter>",
      "eval id/prefix filter; repeatable or comma-separated",
      collectEvalFilter,
      [] as string[],
    )
    .option("--timeout <ms>", "per-eval timeout in ms", parsePositiveInt("--timeout"))
    .option(
      "--max-concurrency <n>",
      "passed to eve eval --max-concurrency",
      parsePositiveInt("--max-concurrency"),
    )
    .option(
      "--max-spend <usd>",
      "abort with exit 4 once cumulative MEASURED cost (gateway cost or " +
        "prices.json fallback) exceeds this USD cap; checked after each suite " +
        "run, partial results are discarded. Unmeasurable costs (mock or " +
        "unpriced models) never trigger the cap",
      parseUsd("--max-spend"),
    )
    .option("--report-md <path>", "write the markdown report here")
    .option("--report-json <path>", "write the JSON report here")
    .option("--json", "print the JSON report to stdout instead of the terminal render", false)
    .option(
      "--cache",
      "reuse/write the 24-hour base cache (opt-in; external state is not part of the key)",
      false,
    )
    .addOption(
      new Option("--fail-on <policy>", "what makes exit code 1")
        .choices(["regression", "drift", "never"])
        .default("regression"),
    )
    .option("--no-color", "disable ANSI in terminal render")
    .action(async (flags: RunFlags) => {
      onExit(await executeRun(flags, io, seams));
    });

  program
    .command("estimate")
    .description(
      "measure one eval-suite pass and project the full comparison's cost " +
        "and duration before spending",
    )
    .requiredOption("--base <ref>", "base git ref (e.g. main, origin/main, a SHA)")
    .option("--head <ref>", "head git ref", "HEAD")
    .option("--repo <path>", "target repo (a git repo with an eve app + evals)", ".")
    .option("--app-dir <path>", "path of the eve app within the repo", ".")
    .addOption(
      new Option(
        "--install-mode <mode>",
        "dependency install policy: scripts-off disables lifecycle/build scripts; scripts-on " +
          "enables repository-controlled scripts and MUST only be used for refs you trust " +
          "(neither mode is a sandbox)",
      )
        .choices(["scripts-off", "scripts-on", "safe", "trusted"])
        .default("scripts-off"),
    )
    .option(
      "--runs <n>",
      "planned eval-suite executions per ref to project",
      parsePositiveInt("--runs"),
      3,
    )
    .option(
      "--evals <filter>",
      "eval id/prefix filter; repeatable or comma-separated",
      collectEvalFilter,
      [] as string[],
    )
    .option(
      "--max-spend <usd>",
      "exit 4 when the projected cost exceeds this USD cap (lets CI gate " +
        "before spending); when cost is unmeasurable the cap cannot be " +
        "enforced ahead of time and the estimate exits 0",
      parseUsd("--max-spend"),
    )
    .action(async (flags: EstimateFlags) => {
      onExit(await executeEstimate(flags, io, seams));
    });

  return program;
}

/**
 * CLI entry point, exported only for in-process tests. argv is process.argv
 * shaped ([node, script, ...args]). Returns the process exit code.
 * `seams` is test-only dependency injection — see CliHarnessSeams.
 */
export async function runCli(
  argv: string[],
  io?: Partial<CliIo>,
  seams?: CliHarnessSeams,
): Promise<number> {
  const fullIo: CliIo = {
    out: io?.out ?? ((text) => process.stdout.write(text)),
    err: io?.err ?? ((text) => process.stderr.write(text)),
  };
  let exitCode = 0;
  const program = buildProgram(
    fullIo,
    (code) => {
      exitCode = code;
    },
    seams,
  );
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help / --version exit "successfully"; everything else is usage (2).
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }
  return exitCode;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (!(typeof DIFF0_ACTION_BUNDLE !== "undefined" && DIFF0_ACTION_BUNDLE) && isDirectExecution()) {
  runCli(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`diff0: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 3;
    });
}
