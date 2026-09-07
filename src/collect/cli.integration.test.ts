import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureCli as cli } from "../../test/helpers/cli.js";
import { demoRepository } from "../../test/helpers/demo-repository.js";
/**
 * The full `diff0 run` pipeline against fixtures/demo-agent.
 *
 * Scratch git repo with unchanged and skill-removal refs,
 * then the REAL CLI (runCli in-process for coverage): N-run counterbalanced
 * comparison, pricing, delta, terminal render, report files, and — on the
 * second invocation — the base-ref cache hit.
 */

import { CACHE_DIR_NAME } from "./cache.js";

// Allow the same per-comparison timeout as the adapter integration test under parallel CI load.
const INTEGRATION_TIMEOUT_MS = 240_000;

let scratch: string;
let agentRepo: string;

const originalDemoModel = process.env.DIFF0_DEMO_MODEL;
beforeAll(async () => {
  process.env.DIFF0_DEMO_MODEL = "mock";
  ({ scratch, agentRepo } = await demoRepository("cli"));
}, INTEGRATION_TIMEOUT_MS);

afterAll(async () => {
  if (originalDemoModel === undefined) delete process.env.DIFF0_DEMO_MODEL;
  else process.env.DIFF0_DEMO_MODEL = originalDemoModel;
  if (scratch !== undefined) {
    await rm(scratch, { recursive: true, force: true });
  }
});

describe("diff0 run end to end", () => {
  it("renders reports, writes the base cache, and reuses it on the next comparison", {
    timeout: INTEGRATION_TIMEOUT_MS,
  }, async () => {
    const mdPath = join(scratch, "reports", "report.md");
    const jsonPath = join(scratch, "reports", "report.json");

    const result = await cli([
      "run",
      "--base",
      "base",
      "--head",
      "head",
      "--repo",
      agentRepo,
      "--runs",
      "2",
      "--cache",
      "--report-md",
      mdPath,
      "--report-json",
      jsonPath,
    ]);

    expect(result.code, result.stderr).toBe(0);

    // Terminal render on stdout: title + validity header.
    expect(result.stdout).toContain("diff0 base...head");
    expect(result.stdout).toContain("eve 0.52.2");
    expect(result.stdout).toContain("model eve-mock/mock-revenue-analyst");
    expect(result.stdout).toContain("2 runs per ref");
    expect(result.stdout).toContain("comparison cost unavailable");
    expect(result.stdout).toContain("EVALS");
    expect(result.stdout).toContain("revenue/total-revenue");
    // The cosmetic file shows up in the diff statistics.
    expect(result.stdout).toContain("CHANGED FILES");
    expect(result.stdout).toContain("cosmetic.txt");

    // Progress went to stderr in counterbalanced order, with run counters.
    expect(result.stderr).toContain("base cache miss");
    expect(result.stderr).toContain("[1/4] base run 1");
    expect(result.stderr).toContain("[2/4] head run 1");
    expect(result.stderr).toContain("[4/4] base run 2");
    expect(result.stderr).toContain("wrote base cache");

    // Markdown report: marker first for the Action's comment upsert.
    const md = await readFile(mdPath, "utf8");
    expect(md.startsWith("<!-- diff0-report -->")).toBe(true);

    // JSON report: schemaVersion 5, green verdict (deterministic mock model).
    const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as {
      schemaVersion: number;
      verdict: string;
      meta: { runsPerRef: number; costSource: string };
    };
    expect(parsed.schemaVersion).toBe(5);
    expect(parsed.verdict).toBe("green");
    expect(parsed.meta.runsPerRef).toBe(2);
    expect(parsed.meta.costSource).toBe("unavailable");

    // Base cache written into the target repo.
    const cacheDir = join(agentRepo, CACHE_DIR_NAME);
    expect(existsSync(cacheDir)).toBe(true);
    const entries = await readdir(cacheDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/);

    // Cache reuse is the second half of this scenario, not a separate test
    // that can run before (or after a failed) cache population.
    const cachedResult = await cli([
      "run",
      "--base",
      "base",
      "--head",
      "head",
      "--repo",
      agentRepo,
      "--runs",
      "2",
      "--cache",
    ]);

    expect(cachedResult.code, cachedResult.stderr).toBe(0);
    expect(cachedResult.stderr).toContain("base cache hit");
    expect(cachedResult.stderr).toContain("[1/2] head run 1");
    expect(cachedResult.stderr).toContain("[2/2] head run 2");
    expect(cachedResult.stderr).not.toContain("base run 1");
    expect(cachedResult.stdout).toContain("diff0 base...head");
  });

  it("exits 2 on an unknown ref without touching worktrees", async () => {
    const result = await cli(["run", "--base", "no-such-ref", "--repo", agentRepo]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Ref "no-such-ref" was not found');
  });

  it("exits 2 on a directory that is not a git repo", async () => {
    const result = await cli(["run", "--base", "main", "--repo", scratch]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a git repository");
  });

  it("exits 2 on bad flag values", async () => {
    expect((await cli(["run", "--base", "base", "--repo", agentRepo, "--runs", "0"])).code).toBe(2);
    expect(
      (await cli(["run", "--base", "base", "--repo", agentRepo, "--fail-on", "bogus"])).code,
    ).toBe(2);
    expect((await cli(["run", "--repo", agentRepo])).code).toBe(2); // --base is required
  });
});
