import { describe, expect, it } from "vitest";
import { computeDelta, violatesEnforcement } from "../analyze/delta.js";
import { applyPricing } from "../collect/pricing.js";
import { parseEveSummary } from "./eve-json.js";
import { summaryToRunRecord } from "./eve-normalize.js";

function capturedRuns(costUsd: number, ref: "base" | "head") {
  const summary = parseEveSummary({
    startedAt: "2026-09-07T00:00:00Z",
    completedAt: "2026-09-07T00:00:01Z",
    results: [
      {
        id: "cost-provenance",
        verdict: "passed",
        assertions: [{ name: "succeeded", passed: true, score: 1 }],
        result: {
          runtimeIdentity: { modelId: "anthropic/claude-haiku-4.5" },
          events: [
            {
              type: "step.completed",
              data: { usage: { inputTokens: 10, outputTokens: 5, costUsd } },
            },
          ],
        },
      },
    ],
  });
  return Array.from({ length: 3 }, (_, runIndex) =>
    summaryToRunRecord(summary, {
      ref,
      commitSha: (ref === "base" ? "a" : "b").repeat(40),
      runIndex,
      eveVersion: "0.47.5",
      sandboxBackend: "unknown",
    }),
  );
}

describe("gateway cost from Eve capture through enforcement", () => {
  it.each([
    { base: 0, head: 0.01, fails: true },
    { base: 0.01, head: 0, fails: false },
    { base: 0, head: 0, fails: false },
  ])("enforces $base → $head without losing measured zero", ({ base, head, fails }) => {
    const pricedBase = applyPricing(capturedRuns(base, "base"));
    const pricedHead = applyPricing(capturedRuns(head, "head"));
    const report = computeDelta(pricedBase.records, pricedHead.records, {
      sandboxInferred: false,
      performanceThresholds: { costUsd: 10 },
    });

    expect(violatesEnforcement(report, ["performance-regression"])).toBe(fails);
    expect(report.meta.mismatches).toEqual([]);
    expect(pricedBase.costSource).toBe("gateway");
    expect(pricedHead.costSource).toBe("gateway");
    expect(pricedBase.records.every((record) => record.costSource === "gateway")).toBe(true);
    expect(report.costPerf.costUsd.base?.median).toBe(base);
    expect(report.costPerf.costUsd.head?.median).toBe(head);
    if (fails) {
      expect(report.costPerf.regressions).toEqual([
        { metric: "costUsd", baseMedian: base, headMedian: head, deltaPct: null, thresholdPct: 10 },
      ]);
    }
  });

  it("keeps legacy caller zeros without provenance unavailable", () => {
    const legacy = capturedRuns(0, "base").map(({ costSource: _source, ...record }) => record);
    const priced = applyPricing(legacy);
    expect(priced.costSource).toBe("unavailable");
    expect(priced.records.every((record) => record.costSource === undefined)).toBe(true);
  });
});
