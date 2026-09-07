import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { compareRefs } from "../src/runner.js";
import { calibrationRepository } from "./helpers/calibration-repository.js";

it("calibrates deliberate regressions through real Eve worktrees", async () => {
  const { repo, git, options, cleanup } = await calibrationRepository();
  try {
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
    await cleanup();
  }
}, 240_000);
