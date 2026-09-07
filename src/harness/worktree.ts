/** Detached checkout lifecycle; installation policy lives in install.ts. */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RefError } from "../errors.js";
import type { DependencyInstallMode } from "../types.js";
import { cleanupResources } from "./cleanup.js";
import { installWorktreeDependencies } from "./install.js";

export {
  installDependencies,
  installWorktreeDependencies,
  sanitizeInstallEnvironment,
} from "./install.js";
export { normalizeAppDirectory, resolveContainedDirectory } from "./paths.js";

const execFileAsync = promisify(execFile);
const INSTALL_MAX_BUFFER = 8 * 1024 * 1024;

export interface WorktreeHandle {
  /** Absolute path of the checked-out worktree. */
  path: string;
  /** Commit SHA the worktree is detached at. */
  commitSha: string;
  /** Remove the worktree, prune metadata, and delete the scratch dir. */
  cleanup(): Promise<void>;
}

export interface CreateWorktreeOptions {
  /** Install dependencies after checkout (default true). */
  install?: boolean;
  /**
   * "scripts-off" disables repository-controlled lifecycle/build scripts (default).
   * "scripts-on" deliberately enables them, while still scrubbing secrets.
   */
  installMode?: DependencyInstallMode;
  /**
   * Additional worktree-relative directories with their own package.json to
   * install in (e.g. the eve app dir in a monorepo). The worktree root is
   * always installed first; "." entries are skipped.
   */
  installDirs?: string[];
  /**
   * Immutable commit already resolved by the comparison orchestrator. Supplying
   * it prevents a moving branch or HEAD from being resolved a second time.
   */
  resolvedCommitSha?: string;
}

async function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: INSTALL_MAX_BUFFER,
  });
}

async function assertGitRepo(repoPath: string): Promise<void> {
  try {
    await git(repoPath, ["rev-parse", "--git-dir"]);
  } catch {
    throw new RefError(`${repoPath} is not a git repository (git rev-parse --git-dir failed).`);
  }
}

/**
 * A literal HEAD comparison can only see the committed snapshot. Reject a
 * dirty checkout instead of silently presenting uncommitted work as tested.
 */
export async function assertCleanHead(repoPath: string): Promise<void> {
  const { stdout } = await git(repoPath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (stdout.length === 0) return;
  const changedCount = stdout.split("\n").filter(Boolean).length;
  throw new RefError(
    `working tree has uncommitted changes (${changedCount} path${changedCount === 1 ? "" : "s"}). ` +
      'The ref "HEAD" means the committed HEAD snapshot, so those changes would be excluded. ' +
      "Commit or stash them, or pass an explicit committed --head ref.",
  );
}

/** Resolve a ref (branch, tag, SHA, HEAD~n, ...) to a full commit SHA. */
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  await assertGitRepo(repoPath);
  if (ref === "HEAD") await assertCleanHead(repoPath);
  try {
    const { stdout } = await git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return stdout.trim();
  } catch {
    throw new RefError(
      `Ref "${ref}" was not found in ${repoPath}. ` +
        "Check the ref name (branch, tag, or commit SHA) and that it exists locally.",
    );
  }
}

export async function createWorktree(
  repoPath: string,
  ref: string,
  opts: CreateWorktreeOptions = {},
): Promise<WorktreeHandle> {
  const commitSha = opts.resolvedCommitSha ?? (await resolveRef(repoPath, ref));

  const scratchDir = await mkdtemp(join(tmpdir(), "diff0-"));
  const worktreePath = join(scratchDir, "worktree");

  const cleanup = async (): Promise<void> => {
    // A failed Git remove can recover through rm + prune, in that order.
    try {
      await git(repoPath, ["worktree", "remove", "--force", worktreePath]);
    } catch {}
    const failures: unknown[] = [];
    try {
      await rm(scratchDir, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      await git(repoPath, ["worktree", "prune"]);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, `Could not fully clean worktree ${worktreePath}`);
  };

  try {
    await git(repoPath, ["worktree", "add", "--detach", worktreePath, commitSha]);
  } catch (error) {
    await cleanupResources([{ cleanup: () => rm(scratchDir, { recursive: true, force: true }) }]);
    throw new Error(
      `git worktree add failed for ${ref} (${commitSha.slice(0, 12)}) in ${repoPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (opts.install !== false) {
    try {
      await installWorktreeDependencies(
        worktreePath,
        opts.installDirs ?? [],
        opts.installMode ?? "scripts-off",
      );
    } catch (error) {
      await cleanupResources([{ cleanup }]);
      throw error;
    }
  }

  return { path: worktreePath, commitSha, cleanup };
}
