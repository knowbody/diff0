/**
 * Frozen installation planning and execution, including workspace ownership
 * and an explicit credential isolation boundary.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { CommandTimeoutError } from "../errors.js";
import { CommandInterruptedError, runCommand } from "../execution.js";
import type { DependencyInstallMode } from "../types.js";
import { cleanupResources } from "./cleanup.js";
import { resolveContainedDirectory } from "./paths.js";

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
  const packageJson = JSON.parse(await readFile(join(worktreePath, "package.json"), "utf8")) as {
    packageManager?: unknown;
  };
  const plan = planInstallation(lockfiles, packageJson.packageManager, installMode, worktreePath);
  await runInstall(worktreePath, plan.bin, plan.args, installMode);
}

export interface InstallationPlan {
  bin: "pnpm" | "npm" | "yarn" | "bun";
  args: string[];
}
/** Pure lockfile-to-command policy, shared by root and independently locked apps. */
export function planInstallation(
  lockfiles: readonly string[],
  packageManager: unknown,
  installMode: DependencyInstallMode,
  directory = "package",
): InstallationPlan {
  if (lockfiles.length === 0)
    throw new Error(
      `Dependency install refused in ${directory}: package.json exists but no supported lockfile was committed. Commit pnpm-lock.yaml, package-lock.json, npm-shrinkwrap.json, yarn.lock, or bun.lock before comparing refs.`,
    );
  if (lockfiles.length > 1)
    throw new Error(
      `Dependency install refused in ${directory}: multiple lockfiles found (${lockfiles.join(", ")}). Keep exactly one package-manager lockfile.`,
    );
  const lockfile = lockfiles[0];
  const scriptsOff = installMode === "scripts-off";
  const ignoreScripts = scriptsOff ? ["--ignore-scripts"] : [];
  switch (lockfile) {
    case "pnpm-lock.yaml":
      return {
        bin: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline", ...ignoreScripts],
      };
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return { bin: "npm", args: ["ci", ...ignoreScripts] };
    case "yarn.lock": {
      const modernYarn =
        typeof packageManager === "string" &&
        Number(packageManager.match(/^yarn@(\d+)/)?.[1] ?? "1") >= 2;
      return {
        bin: "yarn",
        args: [
          "install",
          modernYarn ? "--immutable" : "--frozen-lockfile",
          ...(scriptsOff ? [modernYarn ? "--mode=skip-builds" : "--ignore-scripts"] : []),
        ],
      };
    }
    case "bun.lock":
    case "bun.lockb":
      return { bin: "bun", args: ["install", "--frozen-lockfile", ...ignoreScripts] };
    default:
      throw new Error(`Unsupported lockfile: ${lockfile}`);
  }
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
      const timedOut = error instanceof CommandTimeoutError;
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
    await cleanupResources([{ cleanup: () => rm(isolatedHome, { recursive: true, force: true }) }]);
  }
}
