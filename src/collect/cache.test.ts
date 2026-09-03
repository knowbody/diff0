import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunRecord } from "../types.js";
import {
  CACHE_DIR_NAME,
  CACHE_SCHEMA_VERSION,
  computeCacheKey,
  DEFAULT_CACHE_MAX_AGE_MS,
  getCacheDirectory,
  readCache,
  writeCache,
} from "./cache.js";

function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@test.invalid", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function makeRecord(runIndex: number): RunRecord {
  return {
    ref: "main",
    commitSha: "aaa1111",
    runIndex,
    evalResults: [{ name: "e/one", passed: true, checks: [{ name: "c", passed: true }] }],
    toolCalls: [],
    skillLoads: [],
    skillsLoaded: [],
    subagentCalls: [],
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    costUsd: null,
    durationMs: 1000,
    sandboxBackend: "docker",
    model: "test/model-a",
    pricingModel: "test/model-a",
    eveVersion: "0.29.5",
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-08-03T10:00:00.000Z",
  };
}

let scratch: string;
let repo: string;
let sha1: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "diff0-cache-"));
  repo = join(scratch, "repo");
  await mkdir(join(repo, "agent"), { recursive: true });
  await mkdir(join(repo, "evals"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });

  await writeFile(join(repo, "agent", "instructions.md"), "be helpful\n", "utf8");
  await writeFile(join(repo, "evals", "demo.eval.ts"), "export default 1;\n", "utf8");
  await writeFile(join(repo, "README.md"), "readme\n", "utf8");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "one"]);
  sha1 = gitIn(repo, ["rev-parse", "HEAD"]).trim();
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("computeCacheKey", () => {
  const baseInput = {
    appDir: ".",
    commitSha: "abc",
    eveVersion: "0.29.5",
    model: "test/model-a",
    evalFilter: ["b", "a"],
    timeoutMs: 60_000,
    maxConcurrency: 2,
    sandboxBackend: "docker" as const,
  };

  it("is stable for identical inputs and insensitive to eval filter order", () => {
    const key = computeCacheKey(baseInput);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(computeCacheKey({ ...baseInput })).toBe(key);
    expect(computeCacheKey({ ...baseInput, evalFilter: ["a", "b"] })).toBe(key);
    expect(computeCacheKey({ ...baseInput, installMode: "scripts-off" })).toBe(key);
  });

  it("changes when any component changes", () => {
    const key = computeCacheKey(baseInput);
    expect(computeCacheKey({ ...baseInput, commitSha: "def" })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, eveVersion: "0.30.0" })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, model: "other" })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, evalFilter: ["a"] })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, appDir: "apps/other" })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, timeoutMs: 30_000 })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, maxConcurrency: 1 })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, sandboxBackend: "just-bash" })).not.toBe(key);
    expect(computeCacheKey({ ...baseInput, installMode: "scripts-on" })).not.toBe(key);
  });
});

describe("readCache / writeCache", () => {
  it("round-trips records with metadata", async () => {
    const records = [makeRecord(0), makeRecord(1)];
    const key = computeCacheKey({
      commitSha: sha1,
      eveVersion: "0.29.5",
      model: "test/model-a",
      evalFilter: [],
    });
    await writeCache(repo, key, records);

    const raw = JSON.parse(await readFile(join(repo, CACHE_DIR_NAME, `${key}.json`), "utf8")) as {
      schemaVersion: number;
      key: string;
      createdAt: string;
      diff0Version: string;
      records: unknown[];
    };
    expect(raw.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
    expect(raw.key).toBe(key);
    expect(Date.parse(raw.createdAt)).not.toBeNaN();
    expect(typeof raw.diff0Version).toBe("string");

    expect(await readCache(repo, key)).toEqual(records);
  });

  it("returns null on a missing key", async () => {
    expect(await readCache(repo, "0".repeat(64))).toBeNull();
  });

  it("returns null on corrupt or malformed cache files", async () => {
    await mkdir(join(repo, CACHE_DIR_NAME), { recursive: true });
    await writeFile(join(repo, CACHE_DIR_NAME, "corrupt.json"), "{not json", "utf8");
    expect(await readCache(repo, "corrupt")).toBeNull();

    await writeFile(join(repo, CACHE_DIR_NAME, "norecords.json"), '{"records": 42}', "utf8");
    expect(await readCache(repo, "norecords")).toBeNull();

    await writeFile(
      join(repo, CACHE_DIR_NAME, "badrecord.json"),
      '{"records": [{"ref": "x"}]}',
      "utf8",
    );
    expect(await readCache(repo, "badrecord")).toBeNull();
  });

  it("expires stale entries and rejects future-dated entries", async () => {
    const key = "age";
    await writeCache(repo, key, [makeRecord(0)]);
    const path = join(await getCacheDirectory(repo), `${key}.json`);
    const raw = JSON.parse(await readFile(path, "utf8")) as { createdAt: string };
    const createdAt = Date.parse(raw.createdAt);

    expect(
      await readCache(repo, key, { nowMs: createdAt + DEFAULT_CACHE_MAX_AGE_MS }),
    ).not.toBeNull();
    expect(
      await readCache(repo, key, { nowMs: createdAt + DEFAULT_CACHE_MAX_AGE_MS + 1 }),
    ).toBeNull();
    expect(await readCache(repo, key, { nowMs: createdAt - 5 * 60 * 1000 - 1 })).toBeNull();
  });

  it("rejects schema, version, and key mismatches", async () => {
    for (const [key, mutation] of [
      ["old-schema", (file: Record<string, unknown>) => (file.schemaVersion = 1)],
      ["wrong-version", (file: Record<string, unknown>) => (file.diff0Version = "999.0.0")],
      ["wrong-key", (file: Record<string, unknown>) => (file.key = "some-other-key")],
    ] as const) {
      await writeCache(repo, key, [makeRecord(0)]);
      const path = join(await getCacheDirectory(repo), `${key}.json`);
      const file = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      mutation(file);
      await writeFile(path, JSON.stringify(file), "utf8");
      expect(await readCache(repo, key)).toBeNull();
    }
  });

  it("stores data below git metadata without dirtying the working tree", async () => {
    const key = "clean-tree";
    await writeCache(repo, key, [makeRecord(0)]);
    expect(await getCacheDirectory(repo)).toBe(join(await realpath(repo), ".git", "diff0-cache"));
    expect(gitIn(repo, ["status", "--porcelain"])).toBe("");
  });

  it("resolves linked worktrees to the repository common git directory", async () => {
    const linked = join(scratch, "linked-worktree");
    gitIn(repo, ["worktree", "add", "--detach", linked, sha1]);
    try {
      expect(await getCacheDirectory(linked)).toBe(
        join(await realpath(repo), ".git", "diff0-cache"),
      );
      await writeCache(linked, "linked", [makeRecord(0)]);
      expect(await readCache(repo, "linked")).toEqual([makeRecord(0)]);
      expect(gitIn(linked, ["status", "--porcelain"])).toBe("");
    } finally {
      gitIn(repo, ["worktree", "remove", "--force", linked]);
    }
  });
});
