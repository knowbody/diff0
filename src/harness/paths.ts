import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { ConfigurationError } from "../errors.js";

/** Normalize a repo-relative app path and reject traversal outside the checked-out ref. */
export function normalizeAppDirectory(appDir: string): string {
  if (appDir.includes("\0")) throw new ConfigurationError("app-dir contains a NUL byte");
  const normalized = normalize(appDir.trim() || ".");
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new ConfigurationError(
      `app-dir must stay within the target repository (got "${appDir}")`,
    );
  }
  return normalized;
}

/** Resolve an app directory and reject symlinks that escape the checked-out worktree. */
export async function resolveContainedDirectory(
  worktreePath: string,
  appDir: string,
): Promise<string> {
  const root = await realpath(worktreePath);
  let candidate: string;
  try {
    candidate = await realpath(join(root, normalizeAppDirectory(appDir)));
  } catch {
    throw new ConfigurationError(
      `app-dir does not exist in the target repository (got "${appDir}")`,
    );
  }
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ConfigurationError(
      `app-dir must stay within the target repository (got "${appDir}")`,
    );
  }
  if (!(await stat(candidate)).isDirectory()) {
    throw new ConfigurationError(`app-dir must identify a directory (got "${appDir}")`);
  }
  return candidate;
}
