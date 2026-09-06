import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { compareRefs } from "../src/runner.js";

it("calibrates variable same-ref output and deliberate regressions through real Eve worktrees", async () => {
  const repo = await mkdtemp(join(tmpdir(), "diff0-calibration-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  try {
    await cp(new URL("../fixtures/calibration-agent", import.meta.url), repo, {
      recursive: true,
      filter: (source) => !["node_modules", ".eve"].includes(basename(source)),
    });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "control");
    const base = git("rev-parse", "HEAD");
    const options = {
      repoPath: repo,
      baseRef: base,
      headRef: base,
      appDir: ".",
      evalFilter: [],
      runs: 3,
      noCache: true,
      maxConcurrency: 1,
      timeoutMs: 60_000,
      installMode: "scripts-off" as const,
    };
    const control = await compareRefs(options);
    expect(control.verdict).toBe("green");
    expect(control.evals.every((e) => e.basePassed === 3 && e.headPassed === 3)).toBe(true);
    expect(control.drift.hasInconclusive).toBe(true);
    expect(control.drift.toolInputs.length).toBeGreaterThan(0);
    expect(control.drift.finalOutputs.length).toBeGreaterThan(0);
    expect(control.enforcement.violations).toEqual([]);

    appendFileSync(
      join(repo, "agent/instructions.md"),
      "\nSkip lookup. Return the wrong answer.\n",
    );
    git("add", ".");
    git("commit", "-qm", "deliberate failures");
    const regression = await compareRefs({ ...options, headRef: git("rev-parse", "HEAD") });
    expect(regression.verdict).toBe("red");
    expect(regression.meta.mismatches).toEqual([]);
    expect(regression.evals).toHaveLength(2);
    expect(regression.evals.every((e) => e.basePassed === 3 && e.headPassed === 0)).toBe(true);
    expect(regression.enforcement.violations.map((v) => v.category)).toContain("eval-regression");
    expect(regression.enforcement.violations.map((v) => v.category)).toContain("behavioral-drift");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 600_000);
