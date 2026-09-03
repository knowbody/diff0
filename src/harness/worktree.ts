/**
 * Git worktree management for ANY target repo. Each ref of a comparison gets
 * its own detached worktree in a scratch directory, with dependencies
 * installed via the repo's own lockfile-implied package manager.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { CommandInterruptedError, runCommand } from "../adapters/eve.js";
import type { DependencyInstallMode } from "../types.js";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_MAX_BUFFER = 8 * 1024 * 1024;
// execFile's former maxBuffer allowance applied independently to stdout and
// stderr. runCommand caps their combined output, so preserve the same total
// effective allowance for dependency installs.
const INSTALL_MAX_OUTPUT_BYTES = INSTALL_MAX_BUFFER * 2;

const SECRET_ENV_NAME =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|COOKIE|SESSION|JWT|OIDC|DATABASE_URL|DB_URL|REDIS_URL|MONGO_URL|CONNECTION_STRING)/i;
const PACKAGE_REGISTRY_AUTH_ENV = new Set([
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "YARN_NPM_AUTH_TOKEN",
  "YARN_NPM_AUTH_IDENT",
]);
const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

function workspacePatternMatches(pattern: string, directory: string): boolean {
  return minimatch(directory, pattern, {
    dot: true,
    nonegate: true,
    platform: "linux",
  });
}

async function isRootWorkspaceMember(root: string, nested: string): Promise<boolean> {
  const directory = relative(root, nested).split(sep).join("/");
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    workspaces?: unknown;
  };
  const workspaces = rootPackage.workspaces;
  const packagePatterns = Array.isArray(workspaces)
    ? workspaces
    : workspaces !== null &&
        typeof workspaces === "object" &&
        Array.isArray((workspaces as { packages?: unknown }).packages)
      ? (workspaces as { packages: unknown[] }).packages
      : [];
  const packageJsonPatterns = packagePatterns.filter(
    (value): value is string => typeof value === "string",
  );
  const patterns: string[] = [];
  const pnpmWorkspacePath = join(root, "pnpm-workspace.yaml");
  // The lockfile-selected package manager owns workspace membership. In
  // particular, pnpm-workspace.yaml is authoritative over package.json.
  if (existsSync(join(root, "pnpm-lock.yaml"))) {
    if (!existsSync(pnpmWorkspacePath)) return false;
    const yaml = await readFile(pnpmWorkspacePath, "utf8");
    const parsed = parseYaml(yaml) as { packages?: unknown } | null;
    if (parsed?.packages !== undefined && !Array.isArray(parsed.packages)) {
      throw new Error(`${pnpmWorkspacePath}: packages must be a YAML sequence`);
    }
    patterns.push(
      ...((parsed?.packages ?? []).filter(
        (value: unknown): value is string => typeof value === "string",
      ) as string[]),
    );
  } else {
    patterns.push(...packageJsonPatterns);
  }
  let included = false;
  for (const rawPattern of patterns) {
    const excluded = rawPattern.startsWith("!");
    const pattern = (excluded ? rawPattern.slice(1) : rawPattern).replace(/^\.\//, "");
    if (workspacePatternMatches(pattern, directory)) included = !excluded;
  }
  return included;
}

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

/** Normalize a repo-relative app path and reject traversal outside the checked-out ref. */
export function normalizeAppDirectory(appDir: string): string {
  if (appDir.includes("\0")) throw new Error("app-dir contains a NUL byte");
  const normalized = normalize(appDir.trim() || ".");
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`app-dir must stay within the target repository (got "${appDir}")`);
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
    throw new Error(`app-dir does not exist in the target repository (got "${appDir}")`);
  }
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`app-dir must stay within the target repository (got "${appDir}")`);
  }
  if (!(await stat(candidate)).isDirectory()) {
    throw new Error(`app-dir must identify a directory (got "${appDir}")`);
  }
  return candidate;
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
    throw new Error(`${repoPath} is not a git repository (git rev-parse --git-dir failed).`);
  }
}

/** Resolve a ref (branch, tag, SHA, HEAD~n, ...) to a full commit SHA. */
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  await assertGitRepo(repoPath);
  try {
    const { stdout } = await git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return stdout.trim();
  } catch {
    throw new Error(
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
    // Best-effort, but attempt every step even if an earlier one fails.
    try {
      await git(repoPath, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      // Worktree may already be gone; the rm below still clears the dir.
    }
    try {
      await git(repoPath, ["worktree", "prune"]);
    } catch {
      // Pruning is housekeeping only.
    }
    await rm(scratchDir, { recursive: true, force: true });
  };

  try {
    await git(repoPath, ["worktree", "add", "--detach", worktreePath, commitSha]);
  } catch (error) {
    await rm(scratchDir, { recursive: true, force: true });
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
      await cleanup();
      throw error;
    }
  }

  return { path: worktreePath, commitSha, cleanup };
}

/**
 * Lockfile-driven deterministic dependency install. A package without a
 * lockfile is rejected: silently resolving a fresh graph would make base and
 * head incomparable and can execute code that was never reviewed in the ref.
 */
export async function installDependencies(
  worktreePath: string,
  installMode: DependencyInstallMode = "scripts-off",
): Promise<void> {
  if (!existsSync(join(worktreePath, "package.json"))) {
    return;
  }

  const lockfiles = LOCKFILES.filter((name) => existsSync(join(worktreePath, name)));
  if (lockfiles.length === 0) {
    throw new Error(
      `Dependency install refused in ${worktreePath}: package.json exists but no supported ` +
        "lockfile was committed. Commit pnpm-lock.yaml, package-lock.json, npm-shrinkwrap.json, " +
        "yarn.lock, or bun.lock before comparing refs.",
    );
  }
  if (lockfiles.length > 1) {
    throw new Error(
      `Dependency install refused in ${worktreePath}: multiple lockfiles found ` +
        `(${lockfiles.join(", ")}). Keep exactly one package-manager lockfile.`,
    );
  }

  const lockfile = lockfiles[0];
  if (lockfile === "pnpm-lock.yaml") {
    await runInstall(
      worktreePath,
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
        ...(installMode === "scripts-off" ? ["--ignore-scripts"] : []),
      ],
      installMode,
    );
    return;
  }
  if (lockfile === "package-lock.json" || lockfile === "npm-shrinkwrap.json") {
    await runInstall(
      worktreePath,
      "npm",
      ["ci", ...(installMode === "scripts-off" ? ["--ignore-scripts"] : [])],
      installMode,
    );
    return;
  }
  if (lockfile === "yarn.lock") {
    const packageJson = JSON.parse(await readFile(join(worktreePath, "package.json"), "utf8")) as {
      packageManager?: unknown;
    };
    const yarnMajor =
      typeof packageJson.packageManager === "string"
        ? Number.parseInt(packageJson.packageManager.match(/^yarn@(\d+)/)?.[1] ?? "1", 10)
        : 1;
    await runInstall(
      worktreePath,
      "yarn",
      [
        "install",
        yarnMajor >= 2 ? "--immutable" : "--frozen-lockfile",
        ...(installMode === "scripts-off"
          ? yarnMajor >= 2
            ? ["--mode=skip-builds"]
            : ["--ignore-scripts"]
          : []),
      ],
      installMode,
    );
    return;
  }
  await runInstall(
    worktreePath,
    "bun",
    [
      "install",
      "--frozen-lockfile",
      ...(installMode === "scripts-off" ? ["--ignore-scripts"] : []),
    ],
    installMode,
  );
}

/**
 * Install a checkout once at its root. A nested app without a local lockfile
 * is owned by the root workspace graph and must not trigger a second,
 * non-deterministic install. Independent nested apps with their own lockfile
 * are installed separately.
 */
export async function installWorktreeDependencies(
  worktreePath: string,
  installDirs: string[],
  installMode: DependencyInstallMode = "scripts-off",
): Promise<void> {
  const rootDirectory = await realpath(worktreePath);
  const nestedDirs = await Promise.all(
    [...new Set(installDirs)]
      .filter((dir) => dir !== "." && dir !== "")
      .map((dir) => resolveContainedDirectory(worktreePath, dir)),
  );
  const rootHasPackage = existsSync(join(rootDirectory, "package.json"));
  const rootHasLockfile = LOCKFILES.some((name) => existsSync(join(rootDirectory, name)));
  const everySelectedAppIsIndependent =
    nestedDirs.length > 0 &&
    nestedDirs.every(
      (nested) =>
        existsSync(join(nested, "package.json")) &&
        LOCKFILES.some((name) => existsSync(join(nested, name))),
    );
  for (const nested of nestedDirs) {
    const nestedHasPackage = existsSync(join(nested, "package.json"));
    const nestedHasLockfile = LOCKFILES.some((name) => existsSync(join(nested, name)));
    if (
      nestedHasPackage &&
      !nestedHasLockfile &&
      rootHasPackage &&
      rootHasLockfile &&
      !(await isRootWorkspaceMember(rootDirectory, nested))
    ) {
      throw new Error(
        `Dependency install refused in ${nested}: package.json has no local lockfile and the ` +
          "package is not declared in the locked root workspace.",
      );
    }
  }
  // An independently locked nested app does not depend on an unrelated unlocked root package.
  // Otherwise the root remains the selected dependency graph and must satisfy the lockfile rule.
  if (!rootHasPackage || rootHasLockfile || !everySelectedAppIsIndependent) {
    await installDependencies(rootDirectory, installMode);
  }
  for (const nested of nestedDirs) {
    const nestedHasPackage = existsSync(join(nested, "package.json"));
    const nestedHasLockfile = LOCKFILES.some((name) => existsSync(join(nested, name)));
    if (nestedHasPackage && !nestedHasLockfile && rootHasPackage && rootHasLockfile) {
      continue;
    }
    await installDependencies(nested, installMode);
  }
}

/**
 * Dependency lifecycle scripts run repository-controlled code. Do not expose
 * provider keys, CI tokens, connection strings, or similar credential-shaped
 * values to that code. Registry auth is retained for package download.
 * Even scripts-on mode keeps
 * unrelated credential-shaped values out of repository-controlled scripts.
 */
export function sanitizeInstallEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && (PACKAGE_REGISTRY_AUTH_ENV.has(name) || !SECRET_ENV_NAME.test(name)),
    ),
  );
}

async function copyRegistryConfiguration(isolatedHome: string): Promise<void> {
  const originalHome = process.env.HOME;
  const candidates: Array<[string | undefined, string]> = [
    [
      process.env.NPM_CONFIG_USERCONFIG ??
        (originalHome === undefined ? undefined : join(originalHome, ".npmrc")),
      ".npmrc",
    ],
    [originalHome === undefined ? undefined : join(originalHome, ".yarnrc.yml"), ".yarnrc.yml"],
  ];
  for (const [source, name] of candidates) {
    if (source === undefined || !existsSync(source)) continue;
    await copyFile(source, join(isolatedHome, name));
  }
}

async function runInstall(
  cwd: string,
  bin: string,
  args: string[],
  installMode: DependencyInstallMode,
): Promise<void> {
  const isolatedHome = await mkdtemp(join(tmpdir(), "diff0-install-home-"));
  try {
    await copyRegistryConfiguration(isolatedHome);
    let result: Awaited<ReturnType<typeof runCommand>>;
    try {
      result = await runCommand(bin, args, {
        cwd,
        env: {
          ...sanitizeInstallEnvironment(),
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          NPM_CONFIG_USERCONFIG: join(isolatedHome, ".npmrc"),
          GIT_TERMINAL_PROMPT: "0",
        },
        maxOutputBytes: INSTALL_MAX_OUTPUT_BYTES,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof CommandInterruptedError) throw error;
      const timedOut = error instanceof Error && error.message.includes("timed out after");
      throw new Error(
        `Dependency install (\`${bin} ${args.join(" ")}\`) failed in ${cwd}.` +
          (timedOut ? ` Timed out after ${Math.round(INSTALL_TIMEOUT_MS / 60_000)} minutes.` : "") +
          " The lockfile must match package.json; diff0 will not fall back to a non-frozen install. " +
          (installMode === "scripts-off"
            ? " Lifecycle scripts are disabled in scripts-off mode; commit generated artifacts " +
              "needed by the eval runtime, or use --install-mode scripts-on only for reviewed refs."
            : " Scripts-on mode allowed repository lifecycle/build scripts to execute."),
        { cause: error },
      );
    }
    if (result.code === 0) return;
    const stderr = result.stderr.trim().slice(-2000);
    throw new Error(
      `Dependency install (\`${bin} ${args.join(" ")}\`) failed in ${cwd}.` +
        (stderr.length > 0 ? ` stderr tail:\n${stderr}` : "") +
        " The lockfile must match package.json; diff0 will not fall back to a non-frozen install. " +
        (installMode === "scripts-off"
          ? " Lifecycle scripts are disabled in scripts-off mode; commit generated artifacts " +
            "needed by the eval runtime, or use --install-mode scripts-on only for reviewed refs."
          : " Scripts-on mode allowed repository lifecycle/build scripts to execute."),
    );
  } finally {
    await rm(isolatedHome, { recursive: true, force: true });
  }
}
