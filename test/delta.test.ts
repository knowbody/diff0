import { describe, expect, it } from "vitest";
import {
  COST_DRIFT_THRESHOLD_PCT,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  OPERATIONAL_REGRESSION_MIN_RUNS,
  SOFT_SCORE_REGRESSION_THRESHOLD,
  computeDelta,
  violatesEnforcement,
} from "../src/analyze/delta.js";
import type { EvalDelta } from "../src/analyze/types.js";
import { buildRuns, FIXED_NOW, repeatRuns } from "./helpers/records.js";

function evalByName(evals: EvalDelta[], name: string): EvalDelta {
  const found = evals.find((e) => e.name === name);
  if (!found) throw new Error(`eval ${name} not in report`);
  return found;
}

describe("computeDelta: eval statuses & verdict", () => {
  it("base 3/3 pass, head 0/3 pass -> regressed, verdict red", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { "sql/join": true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { "sql/join": false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const e = evalByName(report.evals, "sql/join");
    expect(e.status).toBe("regressed");
    expect(e.basePassed).toBe(3);
    expect(e.baseTotal).toBe(3);
    expect(e.headPassed).toBe(0);
    expect(e.headTotal).toBe(3);
    expect(e.statisticalEvidence).toMatchObject({
      classification: "regressed",
      method: "one-sided-fisher-exact",
      pValue: 0.05,
      alpha: 0.05,
    });
    expect(report.verdict).toBe("red");
    expect(violatesEnforcement(report, ["eval-regression"])).toBe(true);
    expect(report.verdictSummary).toContain("regressed");
    expect(report.verdictReasons.join("\n")).toContain("passed 3/3 on base, 0/3 on head");
  });

  it("detects a probabilistic 5/5 -> 1/5 pass-rate regression", () => {
    const base = repeatRuns("main", "aaa1111", 5, { evals: { e: true } });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true } },
      { evals: { e: false } },
      { evals: { e: false } },
      { evals: { e: false } },
      { evals: { e: false } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });
    const delta = evalByName(report.evals, "e");
    expect(delta.status).toBe("regressed");
    expect(delta.statisticalEvidence.pValue).toBeCloseTo(0.02381, 5);
    expect(report.verdict).toBe("red");
  });

  it("gates a default 3-run multi-eval all-pass to all-fail collapse without rewriting Holm evidence", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { alpha: true, beta: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { alpha: false, beta: false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    for (const delta of report.evals) {
      expect(delta.statisticalEvidence.pValue).toBe(0.05);
      expect(delta.statisticalEvidence.adjustedPValue).toBe(0.1);
      expect(delta.statisticalEvidence.comparisons).toBe(2);
      expect(delta.status).toBe("inconclusive-regression");
    }
    expect(OPERATIONAL_REGRESSION_MIN_RUNS).toBe(3);
    expect(report.verdict).toBe("red");
    expect(report.verdictSummary).toContain("2 operational eval regressions");
    expect(report.verdictReasons.join("\n")).toContain("alpha operational regression");
    expect(report.verdictReasons.join("\n")).toContain(
      "statistical classification remains inconclusive",
    );
  });

  it("does not apply the operational release gate below 3 complete runs per ref", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { alpha: true, beta: true } });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { alpha: false, beta: false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.evals.every((delta) => delta.status === "inconclusive-regression")).toBe(true);
    expect(report.verdict).toBe("yellow");
    expect(report.verdictReasons.join("\n")).not.toContain("operational regression");
  });

  it("defines the Holm family before observing which evals changed", () => {
    const unchanged = Object.fromEntries(
      Array.from({ length: 99 }, (_, index) => [`same-${index}`, true]),
    );
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { ...unchanged, target: true },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { ...unchanged, target: false },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    const target = evalByName(report.evals, "target");

    expect(target.statisticalEvidence).toMatchObject({
      pValue: 0.05,
      adjustedPValue: 1,
      comparisons: 100,
      classification: "inconclusive",
    });
    expect(target.status).toBe("inconclusive-regression");
    expect(report.verdict).toBe("red");
    expect(report.verdictSummary).toContain("1 operational eval regression");
  });

  it("3/3 vs 1/3 is an observed regression but statistically inconclusive", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { "sql/join": true } });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { "sql/join": true } },
      { evals: { "sql/join": false } },
      { evals: { "sql/join": false } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const e = evalByName(report.evals, "sql/join");
    expect(e.status).toBe("inconclusive-regression");
    expect(e.status).not.toBe("regressed");
    expect(e.statisticalEvidence).toMatchObject({ classification: "inconclusive", pValue: 0.2 });
    expect(report.verdict).toBe("yellow");
    expect(e.twoProportionHint).toBeUndefined();
    expect(report.verdictReasons.join("\n")).toContain("passed 3/3 on base, 1/3 on head");
    expect(report.verdictReasons.join("\n")).toContain("inconclusive");
  });

  it("flaky within base (2/3) with consistent head failure -> flaky-base, not regressed", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { "sql/join": true } },
      { evals: { "sql/join": true } },
      { evals: { "sql/join": false } },
    ]);
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { "sql/join": false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "sql/join").status).toBe("inconclusive-regression");
    expect(report.verdict).not.toBe("red");
  });

  it("flaky on both refs -> flaky-both", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true } },
      { evals: { e: false } },
    ]);
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: false } },
      { evals: { e: true } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(evalByName(report.evals, "e").status).toBe("flaky-both");
  });

  it("base 0/3, head 3/3 -> improved, verdict stays green (no drift)", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { fixed: false } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { fixed: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(evalByName(report.evals, "fixed").status).toBe("improved");
    expect(report.verdict).toBe("green");
    expect(violatesEnforcement(report, ["eval-regression"])).toBe(false);
  });

  it("consistently failing on both refs -> fail (pre-existing failure, not a regression)", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { broken: false } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { broken: false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(evalByName(report.evals, "broken").status).toBe("fail");
    expect(report.verdict).toBe("green");
  });

  it("eval present on only one ref -> missing-base / missing-head", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { "old/eval": true } });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { "new/eval": true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const removed = evalByName(report.evals, "old/eval");
    expect(removed.status).toBe("missing-head");
    expect(removed.headTotal).toBe(0);
    const added = evalByName(report.evals, "new/eval");
    expect(added.status).toBe("missing-base");
    expect(added.baseTotal).toBe(0);
    expect(report.verdict).toBe("yellow");
  });

  it("treats an eval missing from only some runs as incomplete coverage", () => {
    const base = repeatRuns("main", "aaa1111", 5, { evals: { e: true } });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true } },
      {},
      {},
      {},
      {},
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });
    const delta = evalByName(report.evals, "e");

    expect(delta).toMatchObject({
      status: "partial-head",
      basePassed: 5,
      baseTotal: 5,
      baseExpectedRuns: 5,
      headPassed: 1,
      headTotal: 1,
      headExpectedRuns: 5,
    });
    expect(delta.statisticalEvidence).toMatchObject({
      classification: "inconclusive",
      pValue: null,
    });
    expect(report.verdict).toBe("yellow");
    expect(report.verdictReasons.join("\n")).toContain("observed 5/5 base runs and 1/5 head runs");
  });

  it("rejects duplicate eval results within a run instead of inflating N", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true } });
    const duplicate = base[0]?.evalResults[0];
    if (!base[0] || !duplicate) throw new Error("fixture setup failed");
    base[0].evalResults.push({ ...duplicate, checks: [...duplicate.checks] });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });

    expect(() => computeDelta(base, head, { now: FIXED_NOW })).toThrow(
      /duplicate eval result "e" in main runIndex 0/,
    );
  });

  it("evals are sorted most-severe-first", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { zz_ok: true, aa_reg: true, mm_flaky: true },
    });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { zz_ok: true, aa_reg: false, mm_flaky: true } },
      { evals: { zz_ok: true, aa_reg: false, mm_flaky: false } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.evals.map((e) => e.name)).toEqual(["aa_reg", "mm_flaky", "zz_ok"]);
  });
});

describe("computeDelta: two-proportion hint", () => {
  it("computes a labeled hint for a consistent 3/3 vs 0/3 split (z ~ 2.45)", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const hint = evalByName(report.evals, "e").twoProportionHint;
    expect(hint).toBeDefined();
    expect(hint?.zScore).toBeCloseTo(2.45, 2);
    expect(hint?.note).toContain("hint");
    expect(hint?.note).toContain("not statistical significance");
  });

  it("no hint when proportions match (both all-pass)", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(evalByName(report.evals, "e").twoProportionHint).toBeUndefined();
  });
});

describe("computeDelta: soft scores", () => {
  it("reports per-ref medians and delta when checks carry scores", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { judge: { passed: true, scores: [0.9] } } },
      { evals: { judge: { passed: true, scores: [0.8] } } },
      { evals: { judge: { passed: true, scores: [0.85] } } },
    ]);
    const head = buildRuns("feat", "bbb2222", [
      { evals: { judge: { passed: true, scores: [0.6] } } },
      { evals: { judge: { passed: true, scores: [0.7] } } },
      { evals: { judge: { passed: true, scores: [0.65] } } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const soft = evalByName(report.evals, "judge").softScores;
    expect(soft).toEqual({
      baseMedian: 0.85,
      headMedian: 0.65,
      delta: -0.2,
      materialThreshold: SOFT_SCORE_REGRESSION_THRESHOLD,
      classification: "material-regression",
    });
    expect(report.verdict).toBe("yellow");
    expect(report.verdictSummary).toContain("material score regression");
    expect(violatesEnforcement(report, ["score-regression"])).toBe(true);
  });

  it("keeps scorer movement below the material threshold non-gating", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { judge: { passed: true, scores: [0.8] } },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { judge: { passed: true, scores: [0.71] } },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "judge").softScores?.classification).toBe("within-threshold");
    expect(report.verdict).toBe("green");
  });

  it("does not classify a material score improvement as a score regression", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { judge: { passed: true, scores: [0.6] } },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { judge: { passed: true, scores: [0.9] } },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "judge").softScores?.classification).toBe(
      "material-improvement",
    );
    expect(violatesEnforcement(report, ["score-regression"])).toBe(false);
    expect(report.verdict).toBe("green");
  });

  it("aligns soft scores by check identity when a scorer is added", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: {
        judge: {
          passed: true,
          checks: [{ name: "quality", passed: true, score: 1 }],
        },
      },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: {
        judge: {
          passed: true,
          checks: [
            { name: "quality", passed: true, score: 1 },
            { name: "style", passed: false, score: 0 },
          ],
        },
      },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "judge").softScores?.delta).toBe(0);
    expect(report.meta.mismatches.join("\n")).toContain("scored check set differs");
    expect(report.verdict).toBe("yellow");
  });

  it("does not call a sparse scored sample a material regression", () => {
    const base = buildRuns("main", "aaa1111", [
      {
        evals: {
          judge: { passed: true, checks: [{ name: "quality", passed: true, score: 1 }] },
        },
      },
      { evals: { judge: true } },
      { evals: { judge: true } },
    ]);
    const head = buildRuns("feat", "bbb2222", [
      {
        evals: {
          judge: { passed: true, checks: [{ name: "quality", passed: false, score: 0 }] },
        },
      },
      { evals: { judge: true } },
      { evals: { judge: true } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "judge").softScores).toBeUndefined();
    expect(report.meta.mismatches.join("\n")).toContain("scored check coverage is incomplete");
    expect(report.verdict).toBe("yellow");
  });
});

describe("computeDelta: behavioral drift", () => {
  it("skill loaded in 3/3 base runs but 1/3 head runs -> drift entry with exact counts, verdict yellow", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      skills: ["unit-conversion"],
    });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true }, skills: ["unit-conversion"] },
      { evals: { e: true }, skills: [] },
      { evals: { e: true }, skills: [] },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.drift.skills).toEqual([
      expect.objectContaining({
        name: "unit-conversion",
        baseLoadedRuns: 3,
        baseTotalRuns: 3,
        headLoadedRuns: 1,
        headTotalRuns: 3,
        confidence: "inconclusive",
      }),
    ]);
    expect(report.verdict).toBe("yellow");
    expect(report.verdictReasons.join("\n")).toContain("1 of 3 head runs");
    expect(violatesEnforcement(report, ["behavioral-drift"])).toBe(true);
  });

  it("no skill drift entry when proportions match", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true }, skills: ["s"] });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: true }, skills: ["s"] });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.skills).toEqual([]);
    expect(report.drift.hasDrift).toBe(false);
    expect(report.verdict).toBe("green");
  });

  it("tool sequence divergence sets divergenceNote and per-tool call-count deltas", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      tools: ["get_weather", "convert_units", "done"],
    });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true }, tools: ["get_weather", "done"] },
      { evals: { e: true }, tools: ["get_weather", "done"] },
      { evals: { e: true }, tools: ["get_weather", "convert_units", "done"] },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    const [seq] = report.drift.toolSequences;
    if (!seq) throw new Error("expected an eval-scoped tool sequence delta");
    expect(seq.baseMostCommon).toEqual(["get_weather", "convert_units", "done"]);
    expect(seq.baseMostCommonRuns).toBe(3);
    expect(seq.headMostCommon).toEqual(["get_weather", "done"]);
    expect(seq.headMostCommonRuns).toBe(2);
    expect(seq.divergenceNote).toContain("diverges");
    expect(seq.callCountDeltas).toEqual([
      {
        evalName: null,
        name: "convert_units",
        baseMedianCalls: 1,
        headMedianCalls: 0,
        confidence: "inconclusive",
      },
    ]);
    expect(report.verdict).toBe("yellow");
  });

  it("subagent drift mirrors skill drift", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, subagents: ["researcher"] });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.subagents).toEqual([
      expect.objectContaining({
        name: "researcher", baseUsedRuns: 2, baseTotalRuns: 2, headUsedRuns: 0, headTotalRuns: 2,
        confidence: "inconclusive",
      }),
    ]);
    expect(report.verdict).toBe("yellow");
  });

  it("detects skills and subagents moving between evals even when suite totals match", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { alpha: true, beta: true },
      skillLoads: [{ name: "research", evalName: "alpha" }],
      subagentCalls: [{ name: "reviewer", evalName: "alpha" }],
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { alpha: true, beta: true },
      skillLoads: [{ name: "research", evalName: "beta" }],
      subagentCalls: [{ name: "reviewer", evalName: "beta" }],
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.drift.skills.map(({ evalName, baseLoadedRuns, headLoadedRuns }) => ({
      evalName,
      baseLoadedRuns,
      headLoadedRuns,
    }))).toEqual([
      { evalName: "alpha", baseLoadedRuns: 3, headLoadedRuns: 0 },
      { evalName: "beta", baseLoadedRuns: 0, headLoadedRuns: 3 },
    ]);
    expect(report.drift.subagents.map(({ evalName, baseUsedRuns, headUsedRuns }) => ({
      evalName,
      baseUsedRuns,
      headUsedRuns,
    }))).toEqual([
      { evalName: "alpha", baseUsedRuns: 3, headUsedRuns: 0 },
      { evalName: "beta", baseUsedRuns: 0, headUsedRuns: 3 },
    ]);
    expect(report.drift.hasInconclusive).toBe(true);
    expect(report.verdict).toBe("yellow");
  });

  it("confirms a repeated 5/5 -> 0/5 skill change, but keeps one-sample changes inconclusive", () => {
    const base = repeatRuns("main", "aaa1111", 5, { evals: { e: true }, skills: ["s"] });
    const head = repeatRuns("feat", "bbb2222", 5, { evals: { e: true }, skills: [] });
    const confirmed = computeDelta(base, head, { now: FIXED_NOW });
    expect(confirmed.drift.skills[0]).toMatchObject({
      confidence: "statistically-confirmed",
    });
    expect(confirmed.drift.hasDrift).toBe(true);

    const oneBase = repeatRuns("main", "aaa1111", 1, { evals: { e: true }, skills: ["s"] });
    const oneHead = repeatRuns("feat", "bbb2222", 1, { evals: { e: true }, skills: [] });
    const one = computeDelta(oneBase, oneHead, { now: FIXED_NOW });
    expect(one.drift.skills[0]).toMatchObject({ confidence: "inconclusive" });
    expect(one.drift.hasDrift).toBe(false);
    expect(one.drift.hasInconclusive).toBe(true);
  });

  it("includes unchanged behavioral hypotheses in the Holm family", () => {
    const unchanged = Array.from({ length: 6 }, (_, index) => `same-${index}`);
    const base = repeatRuns("main", "aaa1111", 5, {
      evals: { e: true },
      skills: ["target", ...unchanged],
    });
    const head = repeatRuns("feat", "bbb2222", 5, {
      evals: { e: true },
      skills: unchanged,
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.drift.skills).toEqual([
      expect.objectContaining({
        name: "target",
        pValue: 0.007937,
        adjustedPValue: 0.055556,
        confidence: "inconclusive",
      }),
    ]);
    expect(report.drift.hasDrift).toBe(false);
    expect(report.drift.hasInconclusive).toBe(true);
  });

  it("marks modal tool-sequence ties as inconclusive", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true }, tools: ["a"] },
      { evals: { e: true }, tools: ["b"] },
    ]);
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, tools: ["c"] });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.toolSequences[0]?.divergenceConfidence).toBe("inconclusive");
    expect(report.drift.toolSequences[0]?.divergenceNote).toContain("tied");
  });

  it("detects changed tool input hashes at an eval-scoped aligned call without raw inputs", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { refund: true },
      toolInputs: [{ name: "issue_refund", inputsHash: "sha256-small", evalName: "refund" }],
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { refund: true },
      toolInputs: [{ name: "issue_refund", inputsHash: "sha256-large", evalName: "refund" }],
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.toolInputs).toEqual([
      {
        evalName: "refund",
        toolName: "issue_refund",
        occurrence: 1,
        baseHashes: ["sha256-small"],
        headHashes: ["sha256-large"],
        baseFrequencies: [{ hash: "sha256-small", runs: 2 }],
        headFrequencies: [{ hash: "sha256-large", runs: 2 }],
        baseHashRuns: 2,
        headHashRuns: 2,
        confidence: "stable",
      },
    ]);
    expect(report.verdict).toBe("yellow");
    expect(report.verdictReasons.join("\n")).not.toContain("amount");
  });

  it("detects a fingerprint frequency shift even when both refs saw the same distinct hashes", () => {
    const specs = (hashes: string[]) =>
      hashes.map((inputsHash) => ({
        evals: { e: true },
        toolInputs: [{ name: "lookup", inputsHash, evalName: "e" }],
      }));
    const base = buildRuns("main", "aaa1111", specs(["A", "A", "A", "A", "B"]));
    const head = buildRuns("feat", "bbb2222", specs(["A", "B", "B", "B", "B"]));
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.drift.toolInputs).toEqual([
      expect.objectContaining({
        toolName: "lookup",
        baseHashes: ["A", "B"],
        headHashes: ["A", "B"],
        baseFrequencies: [
          { hash: "A", runs: 4 },
          { hash: "B", runs: 1 },
        ],
        headFrequencies: [
          { hash: "A", runs: 1 },
          { hash: "B", runs: 4 },
        ],
        confidence: "inconclusive",
      }),
    ]);
    expect(report.verdict).toBe("yellow");
  });

  it("compares final-output fingerprints without retaining raw output", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { e: true },
      finalOutput: { hash: "sha256-old", length: 10 },
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { e: true },
      finalOutput: { hash: "sha256-new", length: 12 },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.finalOutputs).toEqual([{
      evalName: "e",
      baseCapturedRuns: 2,
      baseTotalRuns: 2,
      headCapturedRuns: 2,
      headTotalRuns: 2,
      baseHashes: ["sha256-old"],
      headHashes: ["sha256-new"],
      baseFrequencies: [{ hash: "sha256-old", runs: 2 }],
      headFrequencies: [{ hash: "sha256-new", runs: 2 }],
      baseLengths: [10],
      headLengths: [12],
      confidence: "stable",
    }]);
    expect(JSON.stringify(report)).not.toContain("raw output");
  });

  it("detects a final-output frequency shift with the same distinct fingerprints", () => {
    const specs = (hashes: string[]) =>
      hashes.map((hash) => ({ evals: { e: true }, finalOutput: { hash } }));
    const base = buildRuns("main", "aaa1111", specs(["A", "A", "A", "A", "B"]));
    const head = buildRuns("feat", "bbb2222", specs(["A", "B", "B", "B", "B"]));
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.drift.finalOutputs[0]).toMatchObject({
      baseHashes: ["A", "B"],
      headHashes: ["A", "B"],
      baseFrequencies: [
        { hash: "A", runs: 4 },
        { hash: "B", runs: 1 },
      ],
      headFrequencies: [
        { hash: "A", runs: 1 },
        { hash: "B", runs: 4 },
      ],
      confidence: "inconclusive",
    });
    expect(report.verdict).toBe("yellow");
  });

  it("reports one-sided loss of final-output capture instead of silently ignoring it", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { e: true },
      finalOutput: { hash: "sha256-old", length: 10 },
    });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.finalOutputs[0]).toMatchObject({
      evalName: "e",
      baseCapturedRuns: 2,
      headCapturedRuns: 0,
      confidence: "inconclusive",
    });
    expect(report.verdict).toBe("yellow");
  });

  it("compares tool trajectories per eval, not by suite result ordering", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { alpha: true, beta: true },
      toolInputs: [
        { name: "alpha_tool", inputsHash: "alpha", evalName: "alpha" },
        { name: "beta_tool", inputsHash: "beta", evalName: "beta" },
      ],
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { beta: true, alpha: true },
      toolInputs: [
        { name: "beta_tool", inputsHash: "beta", evalName: "beta" },
        { name: "alpha_tool", inputsHash: "alpha", evalName: "alpha" },
      ],
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.drift.toolSequences).toEqual([]);
    expect(report.drift.toolInputs).toEqual([]);
    expect(report.verdict).toBe("green");
  });
});

describe("computeDelta: cost & performance", () => {
  it("computes median-based delta percentages (base $0.030 -> head $0.0414 = +38%)", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true }, costUsd: 0.029 },
      { evals: { e: true }, costUsd: 0.03 },
      { evals: { e: true }, costUsd: 0.031 },
    ]);
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true }, costUsd: 0.04 },
      { evals: { e: true }, costUsd: 0.0414 },
      { evals: { e: true }, costUsd: 0.043 },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.costUsd.base?.median).toBeCloseTo(0.03, 6);
    expect(report.costPerf.costUsd.head?.median).toBeCloseTo(0.0414, 6);
    expect(report.costPerf.costUsd.deltaPct).toBeCloseTo(38, 1);
    // >25% median cost increase counts as a directional performance regression.
    expect(report.costPerf.costUsd.deltaPct ?? 0).toBeGreaterThan(COST_DRIFT_THRESHOLD_PCT);
    expect(report.costPerf.regressions).toContainEqual(
      expect.objectContaining({
        metric: "costUsd",
        deltaPct: 38,
        thresholdPct: COST_DRIFT_THRESHOLD_PCT,
      }),
    );
    expect(violatesEnforcement(report, ["performance-regression"])).toBe(true);
    expect(report.verdict).toBe("yellow");
    expect(report.meta.totalComparisonCostUsd).toBeCloseTo(0.2144, 6);
  });

  it("null-cost runs -> cost unavailable (null stats, null total, costSource unavailable), never $0", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, costUsd: null });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, costUsd: null });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.costUsd.base).toBeNull();
    expect(report.costPerf.costUsd.head).toBeNull();
    expect(report.costPerf.costUsd.deltaPct).toBeNull();
    expect(report.meta.totalComparisonCostUsd).toBeNull();
    expect(report.meta.costSource).toBe("unavailable");
  });

  it("all-zero-cost runs (mock models) are also unavailable rather than $0.00", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, costUsd: 0 });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, costUsd: 0 });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.costUsd.base).toBeNull();
    expect(report.meta.totalComparisonCostUsd).toBeNull();
    expect(report.meta.costSource).toBe("unavailable");
  });

  for (const [label, baseCost, headCost] of [
    ["zero to paid", 0, 1],
    ["paid to zero", 1, 0],
  ] as const) {
    it(`${label} cost data is a yellow comparability warning, never green`, () => {
      const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, costUsd: baseCost });
      const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, costUsd: headCost });
      const report = computeDelta(base, head, { now: FIXED_NOW });

      expect(report.meta.totalComparisonCostUsd).toBeNull();
      expect(report.verdict).toBe("yellow");
      expect(report.verdictReasons.join("\n")).toContain("cost comparability unavailable");
      expect(violatesEnforcement(report, ["performance-regression"])).toBe(false);
      expect(violatesEnforcement(report, ["comparison-validity"])).toBe(true);
    });
  }

  it("partial cost coverage (head missing cost) never reports a misleading partial total", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, costUsd: 0.05 });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, costUsd: null });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.costUsd.base).not.toBeNull();
    expect(report.costPerf.costUsd.head).toBeNull();
    expect(report.costPerf.costUsd.deltaPct).toBeNull();
    expect(report.meta.totalComparisonCostUsd).toBeNull();
  });

  it("duration and token medians with ranges", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true }, durationMs: 10000, tokens: { input: 900, output: 180 } },
      { evals: { e: true }, durationMs: 12000, tokens: { input: 1000, output: 200 } },
      { evals: { e: true }, durationMs: 14000, tokens: { input: 1100, output: 220 } },
    ]);
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { e: true },
      durationMs: 18000,
      tokens: { input: 1500, output: 300 },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.durationMs.base).toEqual({ median: 12000, min: 10000, max: 14000 });
    expect(report.costPerf.durationMs.deltaPct).toBeCloseTo(50, 1);
    expect(report.costPerf.tokensIn.deltaPct).toBeCloseTo(50, 1);
    expect(report.costPerf.tokensOut.base?.median).toBe(200);
    expect(report.costPerf.regressions).toEqual([]);
    expect(report.verdict).toBe("green");
  });

  it("turns a 900% duration and token increase into explicit non-green regressions", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      durationMs: 100,
      tokens: { input: 100, output: 20 },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { e: true },
      durationMs: 1000,
      tokens: { input: 1000, output: 200 },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.verdict).toBe("yellow");
    expect(report.costPerf.regressions).toEqual([
      {
        metric: "tokensIn",
        baseMedian: 100,
        headMedian: 1000,
        deltaPct: 900,
        thresholdPct: DEFAULT_PERFORMANCE_THRESHOLDS.tokensIn,
      },
      {
        metric: "tokensOut",
        baseMedian: 20,
        headMedian: 200,
        deltaPct: 900,
        thresholdPct: DEFAULT_PERFORMANCE_THRESHOLDS.tokensOut,
      },
      {
        metric: "durationMs",
        baseMedian: 100,
        headMedian: 1000,
        deltaPct: 900,
        thresholdPct: DEFAULT_PERFORMANCE_THRESHOLDS.durationMs,
      },
    ]);
    expect(report.verdictReasons.join("\n")).toContain(
      "duration/session performance regression: median increased +900% (threshold 100%; base 100, head 1000)",
    );
    expect(violatesEnforcement(report, ["performance-regression"])).toBe(true);
  });

  it("supports stricter directional performance thresholds", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      durationMs: 100,
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { e: true },
      durationMs: 150,
    });
    const report = computeDelta(base, head, {
      now: FIXED_NOW,
      performanceThresholds: { durationMs: 40 },
    });

    expect(report.costPerf.regressions).toContainEqual(
      expect.objectContaining({ metric: "durationMs", deltaPct: 50, thresholdPct: 40 }),
    );
    expect(report.verdict).toBe("yellow");
  });

  it("does not classify cost or performance decreases as regressions", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      costUsd: 0.04,
      durationMs: 1000,
      tokens: { input: 1000, output: 200 },
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { e: true },
      costUsd: 0.02,
      durationMs: 500,
      tokens: { input: 500, output: 100 },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.costPerf.costUsd.deltaPct).toBe(-50);
    expect(report.costPerf.regressions).toEqual([]);
    expect(violatesEnforcement(report, ["performance-regression"])).toBe(false);
    expect(report.verdict).toBe("green");
  });
});

describe("computeDelta: meta, mismatches, caveats, edge cases", () => {
  it("throws a descriptive error on empty run arrays", () => {
    const runs = repeatRuns("main", "aaa1111", 1, { evals: { e: true } });
    expect(() => computeDelta([], runs)).toThrow(/baseRuns is empty/);
    expect(() => computeDelta(runs, [])).toThrow(/headRuns is empty/);
  });

  it("N=1 per ref -> flakiness not detectable, caveat surfaced", () => {
    const base = repeatRuns("main", "aaa1111", 1, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 1, { evals: { e: false } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.flakinessDetectable).toBe(false);
    expect(evalByName(report.evals, "e").status).toBe("inconclusive-regression");
    expect(report.verdict).toBe("yellow");
    expect(report.caveats.join("\n")).toContain("flakiness within a ref cannot be detected");
  });

  it("borderline statuses at N<5 recommend --runs 5", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = buildRuns("feat", "bbb2222", [
      { evals: { e: true } },
      { evals: { e: false } },
      { evals: { e: true } },
    ]);
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.caveats.join("\n")).toContain("--runs 5");
  });

  it("all-pass at N=3 carries no --runs recommendation", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.caveats.join("\n")).not.toContain("--runs 5");
  });

  it("mismatched model between refs populates meta.mismatches", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true }, model: "gpt-5" });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, model: "claude-opus-4" });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.meta.mismatches.some((m) => m.includes("model differs between refs"))).toBe(true);
    expect(report.meta.base.model).toBe("gpt-5");
    expect(report.meta.head.model).toBe("claude-opus-4");
    expect(report.verdict).toBe("yellow");
  });

  it("caps an apparent regression at yellow when model mismatch confounds the comparison", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { e: true },
      model: "gpt-5",
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { e: false },
      model: "claude-opus-4",
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(evalByName(report.evals, "e").status).toBe("regressed");
    expect(report.verdict).toBe("yellow");
    expect(violatesEnforcement(report, ["eval-regression"])).toBe(true);
    expect(violatesEnforcement(report, ["comparison-validity"])).toBe(true);
    expect(report.verdictSummary).toContain("confounded by comparison validity");
  });

  it("caps an apparent regression at yellow when evaluator files changed", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: false } });
    const warning =
      "eval harness differs between refs (1 file): evals/quality.eval.ts. " +
      "Outcome changes may come from evaluator changes rather than agent behavior.";
    const report = computeDelta(base, head, {
      now: FIXED_NOW,
      validityMismatches: [warning],
    });

    expect(report.verdict).toBe("yellow");
    expect(report.meta.mismatches).toContain(warning);
    expect(violatesEnforcement(report, ["comparison-validity"])).toBe(true);
    expect(report.verdictSummary).toContain("confounded by comparison validity");
  });

  it("caps an operational regression at yellow when comparison validity is mismatched", () => {
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { alpha: true, beta: true },
      model: "gpt-5",
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { alpha: false, beta: false },
      model: "claude-opus-4",
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.evals.every((delta) => delta.status === "inconclusive-regression")).toBe(true);
    expect(report.verdict).toBe("yellow");
    expect(report.verdictSummary).toContain(
      "2 operational eval regressions confounded by comparison validity",
    );
  });

  it("surfaces opt-in cache reuse in every rendered report via caveats", () => {
    const base = repeatRuns("main", "aaa1111", 2, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW, baseCacheHit: true });

    expect(report.caveats.join("\n")).toContain("reused from the opt-in cache");
    expect(report.caveats.join("\n")).toContain("external service state");
  });

  it("inconsistent sandbox backend WITHIN one ref is flagged too", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true }, sandboxBackend: "docker" },
      { evals: { e: true }, sandboxBackend: "just-bash" },
    ]);
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true }, sandboxBackend: "docker" });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(
      report.meta.mismatches.some((m) => m.includes("sandbox backend inconsistent within base")),
    ).toBe(true);
  });

  it("differing run counts between refs are flagged", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    expect(report.meta.mismatches.some((m) => m.includes("run counts differ"))).toBe(true);
  });

  it("records data-source presence and run summaries", () => {
    const base = buildRuns("main", "aaa1111", [
      { evals: { e: true }, dataSources: { evalJson: true, spans: true, logs: false } },
      { evals: { e: true }, dataSources: { evalJson: true, spans: false, logs: false } },
    ]);
    const head = repeatRuns("feat", "bbb2222", 2, { evals: { e: true } });
    const report = computeDelta(base, head, { now: FIXED_NOW });

    expect(report.meta.dataSources).toEqual({ evalJson: "all", spans: "partial", logs: "none" });
    expect(report.runSummaries.base).toHaveLength(2);
    expect(report.runSummaries.base[0]).toMatchObject({
      runIndex: 0,
      evalsPassed: 1,
      evalsTotal: 1,
    });
  });

  it("gitDiffStat passes through; defaults to null", () => {
    const base = repeatRuns("main", "aaa1111", 1, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 1, { evals: { e: true } });
    const stat = {
      files: [{ path: "agent/prompts.ts", insertions: 12, deletions: 4 }],
      summary: "1 file changed, 12 insertions(+), 4 deletions(-)",
    };
    expect(computeDelta(base, head, { now: FIXED_NOW }).meta.gitDiffStat).toBeNull();
    expect(computeDelta(base, head, { now: FIXED_NOW, gitDiffStat: stat }).meta.gitDiffStat).toEqual(
      stat,
    );
  });

  it("is deterministic: identical inputs produce identical reports", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true }, skills: ["s"] });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: false } });
    const a = computeDelta(base, head, { now: FIXED_NOW });
    const b = computeDelta(base, head, { now: FIXED_NOW });
    expect(a).toEqual(b);
  });
});
