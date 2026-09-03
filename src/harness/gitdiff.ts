/**
 * `git diff --numstat` between the two compared SHAs, shaped for the report's
 * CHANGED FILES section. Failure-tolerant by contract: the diff stat is
 * correlational enrichment, never a reason to fail a comparison — any git
 * error yields null and the section is simply omitted.
 */

import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";
import type { GitDiffFileStat, GitDiffStat } from "../analyze/types.js";

const execFileAsync = promisify(execFile);

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

  const normalizedAppDir =
    appDir === "." ? "" : `${appDir.split("\\").join("/").replace(/\/$/, "")}/`;
  const evalPrefix = `${posix.join(normalizedAppDir, "evals")}/`;
  return stdout
    .split("\0")
    .filter((path) => path.startsWith(evalPrefix))
    .sort();
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
