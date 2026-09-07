import { execFileSync } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_RULE =
  "- You MUST load the `revenue-definitions` skill before answering any revenue\n  question, so your figures use the canonical definitions.\n";
export function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=diff0-test", "-c", "user.email=test@diff0.invalid", ...args],
    // stderr piped (not inherited): on case-insensitive filesystems git warns
    // that refname "head" is ambiguous with HEAD; harmless here.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Real Git fixture with pinned mock instructions, isolated per integration suite. */
export async function demoRepository(label: string) {
  const fixtureDir = fileURLToPath(new URL("../../fixtures/demo-agent/", import.meta.url));
  const scratch = await mkdtemp(join(tmpdir(), `diff0-${label}-`));
  const agentRepo = join(scratch, "demo-agent");
  await cp(fixtureDir, agentRepo, {
    recursive: true,
    filter: (source) => !["node_modules", ".eve"].includes(basename(source)),
  });
  // Pin the instructions this test asserts against, regardless of what the
  // committed fixture currently says — dogfood PRs edit the fixture's
  // instructions on purpose (that IS the drift demo), and this test must not
  // inherit that drift.
  await writeFile(
    join(agentRepo, "agent", "instructions.md"),
    [
      "# Identity",
      "",
      "You are a meticulous revenue analyst for Demo Corp.",
      "",
      "# Rules",
      "",
      "- You MUST load the `revenue-definitions` skill before answering any revenue",
      "  question, so your figures use the canonical definitions.",
      "- Use the `run_sql` tool to compute figures; never estimate from memory.",
      "- After computing a figure, delegate a one-line executive summary to the",
      "  `reporter` subagent before replying.",
      "- Report totals using the canonical `TOTAL_REVENUE=<n>` format.",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["init", "-q", "-b", "main", agentRepo], { encoding: "utf8" });
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "base"]);
  gitIn(agentRepo, ["branch", "base"]);
  gitIn(agentRepo, ["checkout", "-q", "-b", "head"]);
  await writeFile(join(agentRepo, "cosmetic.txt"), "Behavior remains unchanged.\n");
  gitIn(agentRepo, ["add", "-A"]);
  gitIn(agentRepo, ["commit", "-q", "-m", "head: cosmetic change"]);
  return { scratch, agentRepo };
}
