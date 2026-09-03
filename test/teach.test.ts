/**
 * The no-evals teaching error (exit 2): must TEACH, not just fail — a
 * complete minimal eval + the required evals.config.ts one-liner + docs link.
 * Tested as a pure renderer and end-to-end through runCli with a probe that
 * throws NoEvalsError.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NoEvalsError } from "../src/adapters/eve.js";
import { runCli } from "../src/cli.js";
import { renderNoEvalsHelp } from "../src/report/teach.js";
import type { AgentInfo, EveAdapter, RunOptions, RunRecord } from "../src/types.js";
import type { WorktreeHandle } from "../src/harness/worktree.js";

describe("renderNoEvalsHelp", () => {
  const help = renderNoEvalsHelp(
    "/work/my-agent",
    new NoEvalsError("/tmp/worktree-x", "No eval suites found."),
  );

  it("states that no evals/*.eval.ts files were found in the app dir", () => {
    expect(help).toContain("no evals found");
    expect(help).toContain("/work/my-agent has no evals/*.eval.ts files");
  });

  it("shows a complete minimal eval example", () => {
    expect(help).toContain('import { defineEval } from "eve/evals";');
    expect(help).toContain("export default defineEval({");
    expect(help).toContain('await t.send("What was our total revenue last quarter?");');
    expect(help).toContain("t.succeeded();");
    expect(help).toContain('t.messageIncludes("revenue");');
  });

  it("shows the required evals.config.ts one-liner", () => {
    expect(help).toContain("evals/evals.config.ts");
    expect(help).toContain('import { defineEvalConfig } from "eve/evals";');
    expect(help).toContain("export default defineEvalConfig({});");
  });

  it("points at the eve evals docs", () => {
    expect(help).toContain("https://eve.dev/docs/evals/overview");
  });

  it("relays eve's own message when present, and omits the line when absent", () => {
    expect(help).toContain("(eve said: No eval suites found.)");
    const silent = renderNoEvalsHelp("/work/my-agent", new NoEvalsError("/tmp/wt", "  "));
    expect(silent).not.toContain("eve said");
  });
});

describe("no-evals teaching error through runCli", () => {
  let scratch: string;
  let repo: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "diff0-teach-"));
    repo = join(scratch, "repo");
    await mkdir(repo, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });
    await writeFile(join(repo, "README.md"), "an agent repo without evals\n", "utf8");
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@test.invalid", "add", "-A"],
      { encoding: "utf8" },
    );
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@test.invalid", "commit", "-q", "-m", "one"],
      { encoding: "utf8" },
    );
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  /** probe() throws NoEvalsError — exactly what eve exit code 2 produces. */
  class NoEvalsAdapter implements EveAdapter {
    async probe(cwd: string): Promise<{ eveVersion: string; evalIds: string[] }> {
      throw new NoEvalsError(cwd, "No eval suites found.");
    }
    async runEvalSuite(_ref: string, _sha: string, _opts: RunOptions): Promise<RunRecord> {
      throw new Error("unreachable");
    }
  }

  const fakeWorktree = async (
    _repoPath: string,
    ref: string,
    opts?: { resolvedCommitSha?: string },
  ): Promise<WorktreeHandle> => ({
    path: `/fake-worktree/${ref}`,
    commitSha: opts?.resolvedCommitSha ?? "0".repeat(40),
    cleanup: async () => {},
  });
  const fakeSandbox = async () => ({ backend: "docker" as const, inferred: true as const });
  const fakeAgentInfo = async (_cwd: string): Promise<AgentInfo | null> => null;

  async function cli(args: string[]): Promise<{ code: number; stderr: string }> {
    let stderr = "";
    const code = await runCli(
      ["node", "diff0", ...args],
      {
        out: () => {},
        err: (text) => {
          stderr += text;
        },
      },
      {
        adapter: new NoEvalsAdapter(),
        createWorktree: fakeWorktree,
        inferSandbox: fakeSandbox,
        getAgentInfo: fakeAgentInfo,
      },
    );
    return { code, stderr };
  }

  it("diff0 run exits 2 with the full teaching message", async () => {
    const result = await cli(["run", "--base", "main", "--repo", repo]);
    expect(result.code).toBe(2);
    // Teaches with the user-facing path, not the throwaway worktree path.
    expect(result.stderr).toContain(`${repo} has no evals/*.eval.ts files`);
    expect(result.stderr).not.toContain("/fake-worktree");
    expect(result.stderr).toContain("export default defineEvalConfig({});");
    expect(result.stderr).toContain("export default defineEval({");
    expect(result.stderr).toContain("t.succeeded();");
    expect(result.stderr).toContain("https://eve.dev/docs/evals/overview");
  });

  it("diff0 estimate exits 2 with the same teaching message", async () => {
    const result = await cli(["estimate", "--base", "main", "--repo", repo]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no evals/*.eval.ts files");
    expect(result.stderr).toContain("https://eve.dev/docs/evals/overview");
  });
});
