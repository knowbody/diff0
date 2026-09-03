/**
 * The full `diff0 run` pipeline against fixtures/demo-agent.
 *
 * Scratch git repo with base/head refs (head = cosmetic instructions tweak),
 * then the REAL CLI (runCli in-process for coverage): N-run counterbalanced
 * comparison, pricing, delta, terminal render, report files, and — on the
 * second invocation — the base-ref cache hit.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../cli.js";
import { CACHE_DIR_NAME } from "./cache.js";

// Eve performs four complete eval-suite runs in the first comparison. Under
// Under parallel CI load, current Eve needs the same timeout as the adapter integration test.
const INTEGRATION_TIMEOUT_MS = 240_000;

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const fixtureDir = join(repoRoot, "fixtures", "demo-agent");

function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=diff0-test", "-c", "user.email=test@diff0.invalid", ...args],
    // stderr piped: on case-insensitive filesystems git warns that refname
    // "head" is ambiguous with HEAD; harmless here.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

interface CliCapture {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(args: string[]): Promise<CliCapture> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(["node", "diff0", ...args], {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

let scratch: string;
let agentRepo: string;

beforeAll(async () => {
  // Pin the fixture to its deterministic mock model even on machines where
  // gateway credentials (AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN) are exported:
  // the demo agent auto-selects a real model when it sees a key (see
  // fixtures/demo-agent/agent/lib/demo-model.ts), and this suite must stay
  // hermetic — zero credentials, zero spend. The CLI passes parent env
  // through to the eve subprocess, so this reaches the fixture's agent.ts.
  process.env.DIFF0_DEMO_MODEL = "mock";
  scratch = await mkdtemp(join(tmpdir(), "diff0-m2-"));
  agentRepo = join(scratch, "demo-agent");
  await cp(fixtureDir, agentRepo, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== "node_modules" && name !== ".eve";
    },
  });
  execFileSync("git", ["init", "-q", "-b", "main", agentRepo], { encoding: "utf8" });
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "base"]);
  gitIn(agentRepo, ["branch", "base"]);
  gitIn(agentRepo, ["checkout", "-q", "-b", "head"]);
  appendFileSync(
    join(agentRepo, "agent", "instructions.md"),
    "\n<!-- cosmetic touch-up for the head ref; behavior unchanged -->\n",
  );
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "head: cosmetic instructions tweak"]);
}, INTEGRATION_TIMEOUT_MS);

afterAll(async () => {
  delete process.env.DIFF0_DEMO_MODEL;
  if (scratch !== undefined) {
    await rm(scratch, { recursive: true, force: true });
  }
});

describe("diff0 run end to end", () => {
  it("runs the full comparison, renders reports, and writes the base cache", {
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

    expect(result.code).toBe(0);

    // Terminal render on stdout: title + validity header.
    expect(result.stdout).toContain("diff0 base...head");
    expect(result.stdout).toContain("eve 0.47.5");
    expect(result.stdout).toContain("model eve-mock/mock-revenue-analyst");
    expect(result.stdout).toContain("2 runs per ref");
    expect(result.stdout).toContain("comparison cost unavailable");
    expect(result.stdout).toContain("EVALS");
    expect(result.stdout).toContain("revenue/total-revenue");
    // The cosmetic head tweak shows up as a changed file.
    expect(result.stdout).toContain("CHANGED FILES");
    expect(result.stdout).toContain("agent/instructions.md");

    // Progress went to stderr in counterbalanced order, with run counters.
    expect(result.stderr).toContain("base cache miss");
    expect(result.stderr).toContain("[1/4] base run 1");
    expect(result.stderr).toContain("[2/4] head run 1");
    expect(result.stderr).toContain("[4/4] base run 2");
    expect(result.stderr).toContain("wrote base cache");

    // Markdown report: marker first for the Action's comment upsert.
    const md = await readFile(mdPath, "utf8");
    expect(md.startsWith("<!-- diff0-report -->")).toBe(true);

    // JSON report: schemaVersion 3, green verdict (deterministic mock model).
    const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as {
      schemaVersion: number;
      verdict: string;
      meta: { runsPerRef: number; costSource: string };
    };
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.verdict).toBe("green");
    expect(parsed.meta.runsPerRef).toBe(2);
    expect(parsed.meta.costSource).toBe("unavailable");

    // Base cache written into the target repo.
    const cacheDir = join(agentRepo, CACHE_DIR_NAME);
    expect(existsSync(cacheDir)).toBe(true);
    const entries = await readdir(cacheDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it("hits the base cache on the second invocation and runs head only", {
    timeout: INTEGRATION_TIMEOUT_MS,
  }, async () => {
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
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("base cache hit");
    expect(result.stderr).toContain("[1/2] head run 1");
    expect(result.stderr).toContain("[2/2] head run 2");
    expect(result.stderr).not.toContain("base run 1");
    expect(result.stdout).toContain("diff0 base...head");
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
