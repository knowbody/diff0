/** Synthetic controls complement the real-Eve calibration fixture and live-model measurements. */
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { computeDelta, violatesEnforcement } from "../src/analyze/delta.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { buildRuns, repeatRuns } from "./helpers/records.js";

function variableRuns(side: string, count: number) {
  return buildRuns(
    "same-ref",
    "a".repeat(40),
    Array.from({ length: count }, (_, i) => ({
      evals: { smoke: true },
      skillLoads:
        (i + (side === "head" ? 1 : 0)) % 2 ? [{ name: "optional", evalName: "smoke" }] : [],
      toolInputs: [
        { name: "ask_question", evalName: "smoke", inputsHash: `${side}-question-${i}` },
      ],
      finalOutputs: { smoke: { hash: `${side}-wording-${i}`, length: 80 + i } },
    })),
  );
}

describe("warning calibration", () => {
  it.each([3, 5, 10])("keeps variable same-commit controls informational at N=%i", (n) => {
    const report = computeDelta(variableRuns("base", n), variableRuns("head", n));
    expect(report.evals.every((e) => e.basePassed === n && e.headPassed === n)).toBe(true);
    expect(report.verdict).toBe("green");
    expect(report.drift.hasInconclusive).toBe(true);
    expect(report.drift.finalOutputs).not.toHaveLength(0);
    expect(report.enforcement.violations).toEqual([]);
    expect(violatesEnforcement(report, ["behavioral-drift"])).toBe(false);
    const [overview, details] = renderMarkdown(report).split("<details>");
    expect(overview).not.toContain("Review recommended");
    expect(overview).not.toContain("Final output changed");
    expect(overview).toContain("inconclusive observations retained");
    expect(details).toContain("inconclusive");
  });

  it.each([3, 5, 10])("still gates a broken assertion at N=%i amid variable wording", (n) => {
    const base = variableRuns("base", n);
    const head = variableRuns("head", n);
    for (const run of head) {
      const result = run.evalResults[0];
      assert(result?.checks[0]);
      result.passed = false;
      result.checks[0].passed = false;
    }
    const report = computeDelta(base, head);
    expect(report.verdict).toBe("red");
    expect(violatesEnforcement(report, ["eval-regression"])).toBe(true);
  });

  it("still reviews a repeated required tool disappearing even while answer evals pass", () => {
    const base = repeatRuns("base", "a", 3, { evals: { answer: true }, tools: ["lookup"] });
    const head = repeatRuns("head", "b", 3, { evals: { answer: true } });
    const report = computeDelta(base, head);
    expect(report.verdict).toBe("yellow");
    expect(violatesEnforcement(report, ["behavioral-drift"])).toBe(true);
  });

  it("keeps a partial eval run yellow despite informational wording variation", () => {
    const base = variableRuns("base", 3);
    const head = variableRuns("head", 3);
    assert(head[1]);
    head[1].evalResults = [];
    expect(computeDelta(base, head).verdict).toBe("yellow");
  });

  it("distinguishes an explicitly absent response from missing output evidence", () => {
    const base = variableRuns("base", 3);
    const head = variableRuns("head", 3);
    for (const run of head) {
      const result = run.evalResults[0];
      assert(result);
      delete result.finalOutput;
      result.finalOutputAbsent = true;
    }
    const parked = computeDelta(base, head);
    expect(parked.verdict).toBe("green");
    expect(parked.drift.finalOutputs[0]?.headAbsentRuns).toBe(3);
    for (const run of head) delete run.evalResults[0]?.finalOutputAbsent;
    const missing = computeDelta(base, head);
    expect(missing.verdict).toBe("yellow");
    expect(violatesEnforcement(missing, ["comparison-validity"])).toBe(true);
    expect(violatesEnforcement(missing, ["behavioral-drift"])).toBe(false);

    for (const run of head) {
      const result = run.evalResults[0];
      assert(result?.checks[0]);
      result.passed = false;
      result.checks[0].passed = false;
    }
    const broken = computeDelta(base, head);
    expect(broken.verdict).toBe("red");
    expect(violatesEnforcement(broken, ["eval-regression"])).toBe(true);
    expect(violatesEnforcement(broken, ["comparison-validity"])).toBe(true);
  });

  it("does not let inconclusive output variation hide a performance budget breach", () => {
    const base = variableRuns("base", 3);
    const head = variableRuns("head", 3);
    for (const run of head) run.durationMs *= 3;
    const report = computeDelta(base, head);
    expect(report.verdict).toBe("yellow");
    expect(violatesEnforcement(report, ["performance-regression"])).toBe(true);
    expect(renderMarkdown(report).split("<details>")[0]).toContain("performance regression");
  });

  it("still reviews a stable response disappearing into a known absence", () => {
    const base = repeatRuns("base", "a", 3, {
      evals: { answer: true },
      finalOutputs: { answer: { hash: "fixed-answer", length: 20 } },
    });
    const head = repeatRuns("head", "b", 3, { evals: { answer: true } });
    for (const run of head) {
      const result = run.evalResults[0];
      assert(result);
      result.finalOutputAbsent = true;
    }
    const report = computeDelta(base, head);
    expect(report.verdict).toBe("yellow");
    expect(report.drift.finalOutputs[0]?.confidence).toBe("stable");
    expect(violatesEnforcement(report, ["behavioral-drift"])).toBe(true);
    expect(violatesEnforcement(report, ["comparison-validity"])).toBe(false);
  });
});
