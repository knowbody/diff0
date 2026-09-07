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
import type { PerformanceThresholds } from "./analyze/types.js";
import { getDiff0Version } from "./collect/cache.js";
import { ConfigurationError } from "./errors.js";
import type { HarnessDependencies } from "./harness/dependencies.js";
import { type EstimateOptions, runEstimate } from "./harness/estimate.js";
import { violatesEnforcement } from "./index.js";
import {
  type FailOnPolicy,
  parseFailOn as sharedParseFailOn,
  parseNonNegativePercentage as sharedParseNonNegativePercentage,
  parsePositiveInt as sharedParsePositiveInt,
  parseUsd as sharedParseUsd,
} from "./options.js";
import { renderEstimate } from "./report/estimate.js";
import { formatUsd } from "./report/format.js";
import { renderNoEvalsHelp } from "./report/teach.js";
import { renderJson, renderMarkdown, renderTerminal } from "./reporters.js";
import {
  compareRefs,
  EvalRunError,
  MaxSpendExceededError,
  type RunComparisonOptions,
} from "./runner.js";
import type { DependencyInstallMode } from "./types.js";

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
export type CliHarnessSeams = Partial<HarnessDependencies>;

type InstallModeInput = DependencyInstallMode | "safe" | "trusted";
interface CollectionFlags {
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
  cache: boolean;
}

interface RunFlags extends CollectionFlags {
  validityPath: string[];
  maxCostIncreasePct?: number;
  maxInputTokenIncreasePct?: number;
  maxOutputTokenIncreasePct?: number;
  maxDurationIncreasePct?: number;
  reportMd?: string;
  reportJson?: string;
  json: boolean;
  failOn: FailOnPolicy;
  /** Commander's --no-color: true by default, false when the flag is given. */
  color: boolean;
}

type EstimateFlags = CollectionFlags;

function commanderParser<T>(parse: (value: string) => T): (value: string) => T {
  return (value) => {
    try {
      return parse(value);
    } catch (error) {
      throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
    }
  };
}
const parsePositiveInt = (label: string) => commanderParser(sharedParsePositiveInt(label));
const parseUsd = (label: string) => commanderParser(sharedParseUsd(label));
const parseNonNegativePercentage = (label: string) =>
  commanderParser(sharedParseNonNegativePercentage(label));
const parseFailOn = commanderParser(sharedParseFailOn);

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

/** Additive repo-relative validity globs; validation happens in the harness. */
function collectValidityPath(value: string, previous: string[]): string[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw new InvalidArgumentError("--validity-path must not contain empty globs");
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
  if (error instanceof ConfigurationError) return 2;
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

function collectionOptions(
  flags: CollectionFlags,
  io: CliIo,
  dependencies?: Partial<HarnessDependencies>,
): EstimateOptions {
  return {
    repoPath: resolve(flags.repo),
    appDir: flags.appDir,
    baseRef: flags.base,
    headRef: flags.head,
    runs: flags.runs,
    evalFilter: flags.evals,
    installMode: normalizeInstallMode(flags.installMode, io),
    onProgress: (message) => io.err(`${message}\n`),
    ...(flags.timeout === undefined ? {} : { timeoutMs: flags.timeout }),
    ...(flags.maxConcurrency === undefined ? {} : { maxConcurrency: flags.maxConcurrency }),
    ...(dependencies === undefined ? {} : { dependencies }),
  };
}

async function executeRun(flags: RunFlags, io: CliIo, seams?: CliHarnessSeams): Promise<number> {
  const repoPath = resolve(flags.repo);
  try {
    const comparisonOptions: RunComparisonOptions = {
      ...collectionOptions(flags, io, seams),
      validityPatterns: flags.validityPath,
      noCache: !flags.cache,
      ...(flags.maxSpend === undefined ? {} : { maxSpendUsd: flags.maxSpend }),
    };

    const performanceThresholds: Partial<PerformanceThresholds> = {};
    if (flags.maxCostIncreasePct !== undefined) {
      performanceThresholds.costUsd = flags.maxCostIncreasePct;
    }
    if (flags.maxInputTokenIncreasePct !== undefined) {
      performanceThresholds.tokensIn = flags.maxInputTokenIncreasePct;
    }
    if (flags.maxOutputTokenIncreasePct !== undefined) {
      performanceThresholds.tokensOut = flags.maxOutputTokenIncreasePct;
    }
    if (flags.maxDurationIncreasePct !== undefined) {
      performanceThresholds.durationMs = flags.maxDurationIncreasePct;
    }
    const report = await compareRefs({ ...comparisonOptions, performanceThresholds });

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

    if (flags.failOn.kind === "granular") {
      return violatesEnforcement(report, flags.failOn.categories) ? 1 : 0;
    }
    if (flags.failOn.policy === "never") return 0;
    if (report.verdict === "red") return 1;
    if (report.verdict === "yellow" && flags.failOn.policy === "drift") return 1;
    return 0;
  } catch (error) {
    return reportCliError(error, io, resolve(repoPath, flags.appDir));
  }
}

async function executeEstimate(
  flags: EstimateFlags,
  io: CliIo,
  seams?: CliHarnessSeams,
): Promise<number> {
  const repoPath = resolve(flags.repo);
  try {
    const estimate = await runEstimate({
      ...collectionOptions(flags, io, seams),
      cache: flags.cache,
    });
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

function collectionCommand(command: Command): Command {
  return command
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
      "--cache",
      "reuse/write the 24-hour base cache (opt-in; external state is not part of the key)",
      false,
    );
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

  collectionCommand(program.command("run"))
    .description("behaviorally diff an eve agent between two git refs")
    .option(
      "--validity-path <glob>",
      "additive repo-relative validity glob; repeatable or comma-separated",
      collectValidityPath,
      [] as string[],
    )
    .option(
      "--max-spend <usd>",
      "abort with exit 4 once cumulative MEASURED cost (gateway cost or " +
        "prices.json fallback) exceeds this USD cap; checked after each suite " +
        "run, partial results are discarded. Unmeasurable costs (mock or " +
        "unpriced models) never trigger the cap",
      parseUsd("--max-spend"),
    )
    .option(
      "--max-cost-increase-pct <pct>",
      "maximum median cost increase percentage",
      parseNonNegativePercentage("--max-cost-increase-pct"),
    )
    .option(
      "--max-input-token-increase-pct <pct>",
      "maximum median uncached-input-token increase percentage",
      parseNonNegativePercentage("--max-input-token-increase-pct"),
    )
    .option(
      "--max-output-token-increase-pct <pct>",
      "maximum median output-token increase percentage",
      parseNonNegativePercentage("--max-output-token-increase-pct"),
    )
    .option(
      "--max-duration-increase-pct <pct>",
      "maximum median duration increase percentage",
      parseNonNegativePercentage("--max-duration-increase-pct"),
    )
    .option("--report-md <path>", "write the markdown report here")
    .option("--report-json <path>", "write the JSON report here")
    .option("--json", "print the JSON report to stdout instead of the terminal render", false)
    .addOption(
      new Option(
        "--fail-on <policy>",
        "legacy regression|drift|never, or comma-separated granular categories",
      )
        .argParser(parseFailOn)
        .default({ kind: "legacy", policy: "regression" }, "regression"),
    )
    .option("--no-color", "disable ANSI in terminal render")
    .action(async (flags: RunFlags) => {
      onExit(await executeRun(flags, io, seams));
    });

  collectionCommand(program.command("estimate"))
    .description(
      "measure one eval-suite pass and project the full comparison's cost " +
        "and duration before the full comparison",
    )
    .option(
      "--max-spend <usd>",
      "exit 4 when the projected cost exceeds this USD cap (lets CI gate " +
        "before the full comparison runs); when cost is unmeasurable the cap cannot be " +
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
