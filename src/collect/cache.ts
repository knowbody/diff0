/**
 * Base-ref result cache in `<git-common-dir>/diff0-cache/<key>.json`.
 *
 * Keeping the cache below git's private metadata means a comparison never
 * dirties the target working tree. Resolving the common dir also makes the
 * cache work correctly when `--repo` points at a linked worktree.
 *
 * Every read path is corruption-tolerant: a missing, expired, incompatible,
 * unreadable, or malformed entry is a miss (null), never an error.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DependencyInstallMode, RunRecord, SandboxBackend } from "../types.js";
import { findFileUpward } from "./find-up.js";

const execFileAsync = promisify(execFile);

/** Relative location in a normal (non-linked) checkout. */
export const CACHE_DIR_NAME = join(".git", "diff0-cache");
// v6 stops reusing records that labeled a host-default probe as the actual app sandbox.
export const CACHE_SCHEMA_VERSION = 6;
export const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CacheKeyInput {
  /** Eve app path within the repository; prevents same-commit multi-app collisions. */
  appDir?: string;
  commitSha: string;
  eveVersion: string;
  /** From `eve info --json`; "unknown" when unresolvable. */
  model: string;
  /** Sorted before hashing so filter order never splits the cache. */
  evalFilter: string[];
  /** Per-eval timeout forwarded to eve; omitted and explicit null are equivalent. */
  timeoutMs?: number | null;
  /** Suite concurrency forwarded to eve; omitted and explicit null are equivalent. */
  maxConcurrency?: number | null;
  /** Host-default sandbox candidate; authored app config may override it. */
  sandboxBackend?: SandboxBackend | null;
  /** Dependency lifecycle/build-script policy; scripts can change generated artifacts. */
  installMode?: DependencyInstallMode | null;
}

export interface ReadCacheOptions {
  /** Entries older than this are misses. Set Infinity only for controlled tooling/tests. */
  maxAgeMs?: number;
  /** Clock injection for deterministic tests. */
  nowMs?: number;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** diff0's own version; "unknown" only when package metadata is unavailable. */
export function getDiff0Version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = findFileUpward(here, "package.json");
    if (pkgPath === null) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function computeCacheKey(input: CacheKeyInput): string {
  return sha256(
    JSON.stringify({
      cacheSchemaVersion: CACHE_SCHEMA_VERSION,
      diff0Version: getDiff0Version(),
      appDir: input.appDir ?? ".",
      commitSha: input.commitSha,
      eveVersion: input.eveVersion,
      model: input.model,
      evalFilter: [...input.evalFilter].sort(),
      timeoutMs: input.timeoutMs ?? null,
      maxConcurrency: input.maxConcurrency ?? null,
      sandboxBackend: input.sandboxBackend ?? null,
      installMode: input.installMode ?? "scripts-off",
    }),
  );
}

interface CacheFile {
  schemaVersion: number;
  key: string;
  createdAt: string;
  diff0Version: string;
  records: RunRecord[];
}

/** Resolve git's shared metadata dir, including when repoPath is a linked worktree. */
export async function getCacheDirectory(repoPath: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ));
  } catch {
    // Git before 2.31 does not support --path-format.
    ({ stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }));
  }
  const commonDir = stdout.trim();
  if (commonDir.length === 0) {
    throw new Error(`Could not resolve git common directory for ${repoPath}.`);
  }
  // Older git versions may ignore --path-format and return a relative path.
  return join(isAbsolute(commonDir) ? commonDir : resolve(repoPath, commonDir), "diff0-cache");
}

async function cachePath(repoPath: string, key: string): Promise<string> {
  return join(await getCacheDirectory(repoPath), `${key}.json`);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRunRecord(value: unknown): value is RunRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RunRecord>;
  if (
    typeof record.ref !== "string" ||
    typeof record.commitSha !== "string" ||
    !Number.isInteger(record.runIndex) ||
    (record.runIndex ?? -1) < 0 ||
    !Array.isArray(record.evalResults) ||
    !Array.isArray(record.toolCalls) ||
    !Array.isArray(record.skillLoads) ||
    !Array.isArray(record.skillsLoaded) ||
    !Array.isArray(record.subagentCalls) ||
    !isFiniteNonNegative(record.durationMs) ||
    typeof record.model !== "string" ||
    (record.pricingModel !== null && typeof record.pricingModel !== "string") ||
    typeof record.eveVersion !== "string" ||
    typeof record.startedAt !== "string" ||
    Number.isNaN(Date.parse(record.startedAt))
  ) {
    return false;
  }
  if (
    record.tokens === undefined ||
    !isFiniteNonNegative(record.tokens.input) ||
    !isFiniteNonNegative(record.tokens.output) ||
    !isFiniteNonNegative(record.tokens.cacheRead) ||
    !isFiniteNonNegative(record.tokens.cacheWrite)
  ) {
    return false;
  }
  if (record.costUsd !== null && !isFiniteNonNegative(record.costUsd)) return false;
  if (
    !["docker", "microsandbox", "just-bash", "unknown"].includes(record.sandboxBackend ?? "") ||
    !record.skillsLoaded.every((skill) => typeof skill === "string") ||
    !record.skillLoads.every(
      (load) =>
        load !== null &&
        typeof load === "object" &&
        typeof load.name === "string" &&
        (load.evalName === undefined || typeof load.evalName === "string"),
    ) ||
    !record.toolCalls.every(
      (call) =>
        call !== null &&
        typeof call === "object" &&
        typeof call.name === "string" &&
        Number.isInteger(call.order) &&
        call.order >= 0 &&
        typeof call.inputsHash === "string" &&
        (call.evalName === undefined || typeof call.evalName === "string"),
    ) ||
    !record.subagentCalls.every(
      (call) =>
        call !== null &&
        typeof call === "object" &&
        typeof call.name === "string" &&
        Number.isInteger(call.order) &&
        call.order >= 0 &&
        (call.evalName === undefined || typeof call.evalName === "string"),
    )
  ) {
    return false;
  }
  if (
    record.finalOutput !== undefined &&
    (record.finalOutput === null ||
      typeof record.finalOutput !== "object" ||
      typeof record.finalOutput.hash !== "string" ||
      (record.finalOutput.length !== undefined && !isFiniteNonNegative(record.finalOutput.length)))
  ) {
    return false;
  }
  if (
    record.dataSources === undefined ||
    typeof record.dataSources.evalJson !== "boolean" ||
    typeof record.dataSources.spans !== "boolean" ||
    typeof record.dataSources.logs !== "boolean"
  ) {
    return false;
  }
  return record.evalResults.every(
    (result) =>
      result !== null &&
      typeof result === "object" &&
      typeof result.name === "string" &&
      typeof result.passed === "boolean" &&
      (result.durationMs === undefined || isFiniteNonNegative(result.durationMs)) &&
      (result.finalOutput === undefined ||
        (result.finalOutput !== null &&
          typeof result.finalOutput === "object" &&
          typeof result.finalOutput.hash === "string" &&
          (result.finalOutput.length === undefined ||
            isFiniteNonNegative(result.finalOutput.length)))) &&
      Array.isArray(result.checks) &&
      result.checks.every(
        (check) =>
          check !== null &&
          typeof check === "object" &&
          typeof check.name === "string" &&
          typeof check.passed === "boolean" &&
          (check.score === undefined ||
            (typeof check.score === "number" && check.score >= 0 && check.score <= 1)),
      ),
  );
}

/** Cached base-ref records, or null on miss/expiry/incompatibility/corruption. */
export async function readCache(
  repoPath: string,
  key: string,
  options: ReadCacheOptions = {},
): Promise<RunRecord[] | null> {
  let raw: string;
  try {
    raw = await readFile(await cachePath(repoPath, key), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      parsed.key !== key ||
      parsed.diff0Version !== getDiff0Version() ||
      typeof parsed.createdAt !== "string" ||
      !Array.isArray(parsed.records) ||
      !parsed.records.every(isRunRecord)
    ) {
      return null;
    }
    const createdAtMs = Date.parse(parsed.createdAt);
    const nowMs = options.nowMs ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    if (
      Number.isNaN(createdAtMs) ||
      createdAtMs > nowMs + 5 * 60 * 1000 ||
      maxAgeMs < 0 ||
      nowMs - createdAtMs > maxAgeMs
    ) {
      return null;
    }
    return parsed.records as RunRecord[];
  } catch {
    return null;
  }
}

/** Atomically replace one cache entry, leaving no partially written JSON behind. */
export async function writeCache(
  repoPath: string,
  key: string,
  records: RunRecord[],
): Promise<void> {
  if (!records.every(isRunRecord)) {
    throw new Error("Refusing to cache malformed run records.");
  }
  const file: CacheFile = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    key,
    createdAt: new Date().toISOString(),
    diff0Version: getDiff0Version(),
    records,
  };
  const directory = await getCacheDirectory(repoPath);
  const destination = join(directory, `${key}.json`);
  const temporary = join(directory, `.${key}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
