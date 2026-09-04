/**
 * `git diff --numstat` between the two compared SHAs, shaped for the report's
 * CHANGED FILES section. Failure-tolerant by contract: the diff stat is
 * correlational enrichment, never a reason to fail a comparison — any git
 * error yields null and the section is simply omitted.
 */

import { execFile } from "node:child_process";
import { isAbsolute, posix, win32 } from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import type { GitDiffFileStat, GitDiffStat } from "../analyze/types.js";

const execFileAsync = promisify(execFile);

/** Known Eve-authored sandbox entry points, relative to the selected app. */
export const EVE_SANDBOX_CONFIG_GLOBS = [
  "agent/sandbox.{ts,tsx,js,mjs,cjs}",
  "agent/subagents/**/sandbox.{ts,tsx,js,mjs,cjs}",
] as const;

function appRelativeGlob(appDir: string, pattern: string): string {
  const normalizedAppDir = normalizeRepoPath(appDir);
  return normalizedAppDir === "." ? pattern : posix.join(normalizedAppDir, pattern);
}

function normalizeRepoPath(path: string): string {
  return path.split("\\").join("/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

/**
 * Validate and normalize a user-authored repo-relative glob. Patterns are
 * intentionally additive; callers cannot negate the default eval harness.
 */
export function normalizeValidityPattern(pattern: string): string {
  const normalized = normalizeRepoPath(pattern.trim());
  if (
    pattern.includes("\0") ||
    normalized === "." ||
    normalized.startsWith("!") ||
    isAbsolute(pattern) ||
    win32.isAbsolute(pattern) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`validity pattern must be a contained repo-relative glob (got ${pattern})`);
  }
  return normalized;
}

async function getChangedPaths(
  repoPath: string,
  baseSha: string,
  headSha: string,
): Promise<string[] | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "diff", "--name-only", "--no-renames", "-z", baseSha, headSha],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }
  return stdout
    .split("\0")
    .filter((path) => path.length > 0)
    .map(normalizeRepoPath);
}

function matchingPaths(paths: string[], patterns: readonly string[]): string[] {
  return paths
    .filter((path) =>
      patterns.some((pattern) =>
        minimatch(path, pattern, { dot: true, nonegate: true, windowsPathsNoEscape: true }),
      ),
    )
    .sort();
}

/**
 * Return evaluator files changed between the compared commits. These files
 * define what "pass" means, so changing them confounds an agent comparison.
 * null is reserved for an unexpected git failure.
 */
export async function getEvalHarnessChanges(
  repoPath: string,
  baseSha: string,
  headSha: string,
  appDir: string,
  validityPatterns: readonly string[] = [],
): Promise<string[] | null> {
  const patterns = [
    appRelativeGlob(appDir, "evals/**"),
    ...validityPatterns.map(normalizeValidityPattern),
  ];
  const paths = await getChangedPaths(repoPath, baseSha, headSha);
  if (paths === null) return null;
  return matchingPaths(paths, patterns);
}

/**
 * Return changed, authored Eve sandbox entry points. The host capability
 * probe cannot reveal whether either ref overrides Eve's default backend, so
 * a change to one of these files is an explicit comparison-validity warning.
 */
export async function getSandboxConfigChanges(
  repoPath: string,
  baseSha: string,
  headSha: string,
  appDir: string,
): Promise<string[] | null> {
  const paths = await getChangedPaths(repoPath, baseSha, headSha);
  if (paths === null) return null;
  return matchingPaths(
    paths,
    EVE_SANDBOX_CONFIG_GLOBS.map((pattern) => appRelativeGlob(appDir, pattern)),
  );
}

/**
 * Line stats per changed file between baseSha and headSha. Binary files
 * (numstat prints "-\t-") are reported as 0 insertions / 0 deletions.
 * Returns null when git fails for any reason.
 */
export async function getDiffStat(
  repoPath: string,
  baseSha: string,
  headSha: string,
): Promise<GitDiffStat | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "diff", "--numstat", baseSha, headSha],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }

  const files: GitDiffFileStat[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = parseNumstatLine(line);
    if (parsed !== null) files.push(parsed);
  }

  return { files, summary: summarize(files) };
}

/** One numstat line: "<insertions>\t<deletions>\t<path>"; "-" marks binary. */
function parseNumstatLine(line: string): GitDiffFileStat | null {
  const firstTab = line.indexOf("\t");
  if (firstTab === -1) return null;
  const secondTab = line.indexOf("\t", firstTab + 1);
  if (secondTab === -1) return null;

  const insertionsRaw = line.slice(0, firstTab);
  const deletionsRaw = line.slice(firstTab + 1, secondTab);
  const path = line.slice(secondTab + 1);
  if (path === "") return null;

  return {
    path,
    insertions: parseCount(insertionsRaw),
    deletions: parseCount(deletionsRaw),
  };
}

function parseCount(raw: string): number {
  if (raw === "-") return 0; // binary file
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? 0 : value;
}

/** Mimics `git diff --shortstat`: zero-count segments are omitted. */
function summarize(files: GitDiffFileStat[]): string {
  const insertions = files.reduce((acc, f) => acc + f.insertions, 0);
  const deletions = files.reduce((acc, f) => acc + f.deletions, 0);
  const parts = [`${files.length} file${files.length === 1 ? "" : "s"} changed`];
  if (insertions > 0) parts.push(`${insertions} insertion${insertions === 1 ? "" : "s"}(+)`);
  if (deletions > 0) parts.push(`${deletions} deletion${deletions === 1 ? "" : "s"}(-)`);
  return parts.join(", ");
}
