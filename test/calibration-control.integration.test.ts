import { expect, it } from "vitest";
import { compareRefs } from "../src/runner.js";
import { calibrationRepository } from "./helpers/calibration-repository.js";

it("calibrates variable same-ref output through real Eve worktrees", async () => {
  const { options, cleanup } = await calibrationRepository();
  try {
    const control = await compareRefs(options);
    expect(control.verdict).toBe("green");
    expect(control.evals.every((e) => e.basePassed === 3 && e.headPassed === 3)).toBe(true);
    expect(control.drift.hasInconclusive).toBe(true);
    expect(control.drift.toolInputs.length).toBeGreaterThan(0);
    expect(control.drift.finalOutputs.length).toBeGreaterThan(0);
    expect(control.enforcement.violations).toEqual([]);
  } finally {
    await cleanup();
  }
}, 240_000);
