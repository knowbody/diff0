import { describe, expect, it } from "vitest";
import { parseEveListing, parseEveSummary } from "./eve-json.js";
import { summaryToRunRecord } from "./eve-normalize.js";

describe("consumed Eve JSON boundary", () => {
  it.each([
    null,
    { results: null },
    { results: [null] },
    { results: [{ id: "e", result: { events: null } }] },
    { results: [{ id: "e", result: { events: [{ data: { usage: { inputTokens: -1 } } }] } }] },
  ])("rejects malformed consumed fields: %j", (value) => {
    expect(() => parseEveSummary(value)).toThrow();
  });
  it("tolerates added upstream fields and rejects reversed timestamps", () => {
    expect(
      parseEveSummary({ results: [{ id: "e", future: true }], future: {} }).results,
    ).toHaveLength(1);
    expect(() =>
      parseEveSummary({ results: [], startedAt: "2026-01-02", completedAt: "2026-01-01" }),
    ).toThrow(/precedes/);
    const record = summaryToRunRecord(
      { startedAt: "2026-01-02", completedAt: "2026-01-01" },
      { ref: "main", commitSha: "a", runIndex: 0, eveVersion: "v", sandboxBackend: "unknown" },
    );
    expect(record.durationMs).toBe(0);
  });
  it("rejects null listing entries instead of crashing during ID access", () => {
    expect(() => parseEveListing([null])).toThrow();
  });
});

it.each([false, true])(
  "attributes modern and legacy usage within each eval (reverse=%s)",
  (reverse) => {
    const modern = {
      id: "modern",
      verdict: "passed",
      result: {
        runtimeIdentity: { modelId: "A" },
        events: [
          { type: "step.started", data: { turnId: "t", stepIndex: 0, modelId: "A" } },
          {
            type: "step.completed",
            data: { turnId: "t", stepIndex: 0, usage: { inputTokens: 100, outputTokens: 10 } },
          },
        ],
      },
    };
    const legacy = {
      id: "legacy",
      verdict: "passed",
      result: {
        runtimeIdentity: { modelId: "B" },
        events: [
          { type: "step.completed", data: { usage: { inputTokens: 200, outputTokens: 20 } } },
        ],
      },
    };
    const record = summaryToRunRecord(
      { results: reverse ? [legacy, modern] : [modern, legacy] },
      { ref: "r", commitSha: "s", runIndex: 0, eveVersion: "v", sandboxBackend: "unknown" },
    );
    expect(record.tokens).toMatchObject({ input: 300, output: 30 });
    expect(record.model).toBe("A / B");
    expect(record.pricingModel).toBeNull();
  },
);

it.each([-1, 2])("rejects an assertion score outside the normalized contract (%s)", (score) => {
  expect(() => parseEveSummary({ results: [{ id: "eval", assertions: [{ score }] }] })).toThrow();
});
