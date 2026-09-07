/** A committed skill removal must reach report evidence and CLI policy enforcement. */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureCli as cli } from "../../test/helpers/cli.js";
import { demoRepository, gitIn, SKILL_RULE } from "../../test/helpers/demo-repository.js";
import type { DeltaReport } from "../analyze/types.js";

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

describe("deterministic behavioral drift", () => {
  it("carries deterministic skill removal through collection, reports and granular exit enforcement", {
    timeout: INTEGRATION_TIMEOUT_MS,
  }, async () => {
    gitIn(agentRepo, ["checkout", "-q", "-b", "skill-drift", "base"]);
    const instructionsPath = join(agentRepo, "agent", "instructions.md");
    const before = await readFile(instructionsPath, "utf8");
    expect(before).toContain(SKILL_RULE);
    await writeFile(instructionsPath, before.replace(SKILL_RULE, ""));
    gitIn(agentRepo, ["add", "agent/instructions.md"]);
    gitIn(agentRepo, ["commit", "-q", "-m", "remove required skill load"]);
    const mdPath = join(scratch, "drift.md");
    const result = await cli([
      "run",
      "--base",
      "base",
      "--head",
      "skill-drift",
      "--repo",
      agentRepo,
      "--runs",
      "3",
      "--fail-on",
      "behavioral-drift",
      "--json",
      "--report-md",
      mdPath,
    ]);
    expect(result.code, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as Pick<
      DeltaReport,
      "evals" | "verdict" | "drift" | "enforcement"
    >;
    expect(report.verdict).toBe("yellow");
    expect(report.enforcement.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "behavioral-drift" })]),
    );
    expect(JSON.stringify(report.drift)).toContain("revenue-definitions");
    expect(
      report.evals.every(
        (evaluation) =>
          evaluation.headPassed === evaluation.headTotal &&
          evaluation.headTotal === evaluation.headExpectedRuns,
      ),
    ).toBe(true);
    expect(await readFile(mdPath, "utf8")).toContain("revenue-definitions");
  });
});
