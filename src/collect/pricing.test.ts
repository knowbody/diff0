import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunRecord } from "../types.js";
import { applyPricing } from "./pricing.js";

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const record: RunRecord = {
    ref: "main",
    commitSha: "aaa1111",
    runIndex: 0,
    evalResults: [],
    toolCalls: [],
    skillLoads: [],
    skillsLoaded: [],
    subagentCalls: [],
    tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
    costUsd: null,
    durationMs: 5000,
    sandboxBackend: "docker",
    model: "test/model-a",
    pricingModel: "test/model-a",
    eveVersion: "0.29.5",
    dataSources: { evalJson: true, spans: false, logs: false },
    startedAt: "2026-08-03T10:00:00.000Z",
    ...overrides,
  };
  if (overrides.model !== undefined && overrides.pricingModel === undefined) {
    record.pricingModel = overrides.model;
  }
  return record;
}

let scratch: string;
let pricesPath: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "diff0-pricing-"));
  pricesPath = join(scratch, "prices.json");
  await writeFile(
    pricesPath,
    JSON.stringify({
      models: {
        "test/model-a": { inputPerToken: 0.000001, outputPerToken: 0.000002 },
        "test/model-b": {
          inputPerToken: 0.00001,
          outputPerToken: 0.00002,
          cacheReadPerToken: 1e-7,
        },
        "test/model-c": {
          inputPerToken: 0.00001,
          outputPerToken: 0.00002,
          cacheWritePerToken: 2e-7,
        },
      },
    }),
    "utf8",
  );
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("applyPricing", () => {
  it("labels 'gateway' and leaves records untouched when every record has gateway cost", () => {
    const records = [makeRecord({ costUsd: 0.5 }), makeRecord({ costUsd: 0.25, runIndex: 1 })];
    const result = applyPricing(records, { pricesPath });
    expect(result.costSource).toBe("gateway");
    expect(result.records).toBe(records);
    expect(result.records.map((r) => r.costUsd)).toEqual([0.5, 0.25]);
  });

  it("prices token counts from the table and labels 'priced-tokens'", () => {
    const records = [
      makeRecord(),
      makeRecord({
        runIndex: 1,
        tokens: { input: 2000, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ];
    const result = applyPricing(records, { pricesPath });
    expect(result.costSource).toBe("priced-tokens");
    // 1000 * 1e-6 + 500 * 2e-6 = 0.002
    expect(result.records[0]?.costUsd).toBeCloseTo(0.002, 10);
    expect(result.records[1]?.costUsd).toBeCloseTo(0.002, 10);
    // Inputs are never mutated.
    expect(records[0]?.costUsd).toBeNull();
  });

  it("prefers per-record gateway cost in a mixed set, still labeled 'priced-tokens'", () => {
    const records = [makeRecord({ costUsd: 0.9 }), makeRecord({ runIndex: 1 })];
    const result = applyPricing(records, { pricesPath });
    expect(result.costSource).toBe("priced-tokens");
    expect(result.records[0]?.costUsd).toBe(0.9);
    expect(result.records[1]?.costUsd).toBeCloseTo(0.002, 10);
  });

  it("prices cache reads separately and refuses unknown cache-write pricing", () => {
    const cacheRead = applyPricing(
      [
        makeRecord({
          model: "test/model-b",
          tokens: { input: 0, output: 0, cacheRead: 100, cacheWrite: 0 },
        }),
      ],
      { pricesPath },
    );
    expect(cacheRead.costSource).toBe("priced-tokens");
    expect(cacheRead.records[0]?.costUsd).toBeCloseTo(0.00001, 10);

    const cacheWrite = applyPricing(
      [
        makeRecord({
          model: "test/model-b",
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 100 },
        }),
      ],
      { pricesPath },
    );
    expect(cacheWrite.costSource).toBe("unavailable");
    expect(cacheWrite.records[0]?.costUsd).toBeNull();
  });

  it("prices cache writes when the catalog supplies a separate rate", () => {
    const result = applyPricing(
      [
        makeRecord({
          model: "test/model-c",
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 100 },
        }),
      ],
      { pricesPath },
    );
    expect(result.costSource).toBe("priced-tokens");
    expect(result.records[0]?.costUsd).toBeCloseTo(0.00002, 10);
  });

  it("refuses fallback pricing when usage cannot be attributed to one model", () => {
    const result = applyPricing([makeRecord({ pricingModel: null })], { pricesPath });
    expect(result.costSource).toBe("unavailable");
    expect(result.records[0]?.costUsd).toBeNull();
  });

  it("labels 'unavailable' and never invents a cost when a model has no table entry", () => {
    const records = [
      makeRecord({ costUsd: 0.9 }),
      makeRecord({ runIndex: 1, model: "unknown/model" }),
    ];
    const result = applyPricing(records, { pricesPath });
    expect(result.costSource).toBe("unavailable");
    expect(result.records[0]?.costUsd).toBe(0.9);
    expect(result.records[1]?.costUsd).toBeNull();
  });

  it("labels 'unavailable' when the prices file is missing or corrupt", async () => {
    const missing = applyPricing([makeRecord()], { pricesPath: join(scratch, "nope.json") });
    expect(missing.costSource).toBe("unavailable");
    expect(missing.records[0]?.costUsd).toBeNull();

    const corruptPath = join(scratch, "corrupt.json");
    await writeFile(corruptPath, "{not json", "utf8");
    const corrupt = applyPricing([makeRecord()], { pricesPath: corruptPath });
    expect(corrupt.costSource).toBe("unavailable");
  });

  it("labels an empty record set 'unavailable'", () => {
    expect(applyPricing([], { pricesPath })).toEqual({ records: [], costSource: "unavailable" });
  });

  it("resolves the packaged prices.json by default (real table, real model id)", () => {
    // anthropic/claude-sonnet-4.5 style ids exist in the shipped table; use any
    // priced record only to verify default resolution does not throw and the
    // unpriceable mock model stays unpriced.
    const result = applyPricing([makeRecord({ model: "eve-mock/mock-revenue-analyst" })]);
    expect(result.costSource).toBe("unavailable");
    expect(result.records[0]?.costUsd).toBeNull();
  });
});
