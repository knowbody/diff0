import { describe, expect, it } from "vitest";
import { computeDelta } from "../src/analyze/delta.js";
import { formatUsd } from "../src/report/format.js";
import { renderJson } from "../src/report/json.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { renderTerminal } from "../src/report/terminal.js";
import { FIXED_NOW, repeatRuns } from "./helpers/records.js";

describe("formatUsd", () => {
  it("renders exact zero as $0.0000", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("renders tiny positive values below the four-decimal threshold as <$0.0001", () => {
    expect(formatUsd(0.00001)).toBe("<$0.0001");
    expect(formatUsd(0.000099)).toBe("<$0.0001");
    expect(formatUsd(Number.MIN_VALUE)).toBe("<$0.0001");
  });

  it("renders the boundary value 0.0001 as $0.0001", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
  });

  it("preserves the less-than marker even when rounding would reach $0.0001", () => {
    // 0.00009999 rounds up to 0.0001 at four decimals, but is still < 0.0001,
    // so it must use the sentinel rather than the misleading rounded value.
    expect(formatUsd(0.00009999)).toBe("<$0.0001");
  });

  it("preserves existing sub-$1 formatting away from the tiny-value boundary", () => {
    expect(formatUsd(0.03)).toBe("$0.0300");
    expect(formatUsd(0.5)).toBe("$0.5000");
  });

  it("preserves existing $1-and-up formatting", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12)).toBe("$12.00");
  });

  it("does not apply the sentinel to zero or negative values", () => {
    expect(formatUsd(-0.00001)).toBe("$-0.0000");
  });
});

describe("tiny costs in rendered reports", () => {
  const costUsd = 0.00001;
  const report = computeDelta(
    repeatRuns("main", "aaa1111", 3, { evals: { smoke: true }, costUsd }),
    repeatRuns("fix", "bbb2222", 3, { evals: { smoke: true }, costUsd }),
    { now: FIXED_NOW, costSource: "gateway" },
  );

  it.each([
    ["Markdown", () => renderMarkdown(report)],
    ["terminal", () => renderTerminal(report, { color: false })],
  ] as const)("shows nonzero comparison and session costs in %s", (_name, render) => {
    const output = render();
    expect(output).toContain("comparison cost <$0.0001");
    expect(output).not.toContain("$0.0000");
    const costRow = output.split("\n").find((line) => /cost\s*\/\s*session/i.test(line));
    expect(costRow).toContain("<$0.0001");
  });

  it("preserves numeric precision in JSON instead of inserting the display marker", () => {
    const output = renderJson(report);
    const json = JSON.parse(output);
    expect(json.costPerf.costUsd.base.median).toBe(costUsd);
    expect(json.costPerf.costUsd.head.median).toBe(costUsd);
    expect(json.meta.totalComparisonCostUsd).toBeCloseTo(6 * costUsd, 12);
    expect(output).not.toContain("<$0.0001");
  });
});

it("keeps a budget explanation visibly above its threshold", async () => {
  const { performanceBudgetFacts } = await import("../src/report/facts.js");
  expect(
    performanceBudgetFacts({
      metric: "durationMs",
      baseMedian: 100,
      headMedian: 110.04,
      deltaPct: 10.04,
      thresholdPct: 10,
    }),
  ).toMatchObject({ delta: "+10.04%", threshold: "+10%" });
});

it("explains known zero baselines in amounts rather than an invented percentage", async () => {
  const { performanceBudgetFacts } = await import("../src/report/facts.js");
  const facts = performanceBudgetFacts({
    metric: "costUsd",
    baseMedian: 0,
    headMedian: 0.01,
    deltaPct: null,
    thresholdPct: 25,
  });
  expect(facts.delta).toBeNull();
  expect(facts.text).toContain("from $0.0000 to $0.0100");
  expect(facts.text).toContain("allows no increase from a zero baseline");
});
