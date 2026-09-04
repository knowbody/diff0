import { describe, expect, it } from "vitest";
import { computeDelta } from "../src/analyze/delta.js";
import { JSON_SCHEMA_VERSION, renderJson } from "../src/report/json.js";
import { buildRuns, FIXED_NOW, repeatRuns } from "./helpers/records.js";

function sampleReport() {
  const base = repeatRuns("main", "aaa1111222233334444", 2, {
    evals: { "sql/join": true },
    tools: ["run_sql"],
    skills: ["unit-conversion"],
  });
  const head = buildRuns("feat", "bbb2222333344445555", [
    { evals: { "sql/join": true }, tools: ["run_sql"] },
    { evals: { "sql/join": false }, tools: ["run_sql", "run_sql"] },
  ]);
  return computeDelta(base, head, { now: FIXED_NOW });
}

function assertKeysSortedDeep(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => assertKeysSortedDeep(entry, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    expect(keys, `keys at ${path}`).toEqual([...keys].sort());
    for (const key of keys) {
      assertKeysSortedDeep((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

describe("renderJson", () => {
  it("renders byte-identical output for the same report (stable ordering)", () => {
    const report = sampleReport();
    expect(renderJson(report)).toBe(renderJson(report));
    // And across two independent computations of the same inputs.
    expect(renderJson(sampleReport())).toBe(renderJson(sampleReport()));
  });

  it("recursively sorts every object's keys", () => {
    const parsed: unknown = JSON.parse(renderJson(sampleReport()));
    assertKeysSortedDeep(parsed, "$");
  });

  it("carries schemaVersion 4", () => {
    const parsed = JSON.parse(renderJson(sampleReport())) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(parsed.schemaVersion).toBe(4);
  });

  it("is pretty-printed and newline-terminated", () => {
    const out = renderJson(sampleReport());
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain('\n  "schemaVersion": 4');
  });

  it("round-trips the full report content", () => {
    const parsed = JSON.parse(renderJson(sampleReport())) as Record<string, unknown>;
    expect(parsed).toHaveProperty("verdict");
    expect(parsed).toHaveProperty("evals");
    expect(parsed).toHaveProperty("meta");
    expect(parsed).toHaveProperty("drift");
    expect(parsed).toHaveProperty("costPerf");
    expect(parsed).toHaveProperty("enforcement");
    expect(parsed).toHaveProperty("runSummaries");
  });

  it("publishes comparison-local opaque fingerprint labels, never deterministic hashes", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { e: true },
      toolInputs: [{ name: "lookup", inputsHash: "sha256-secret-old", evalName: "e" }],
      finalOutput: { hash: "sha256-output-old" },
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { e: true },
      toolInputs: [{ name: "lookup", inputsHash: "sha256-secret-new", evalName: "e" }],
      finalOutput: { hash: "sha256-output-new" },
    });
    const report = computeDelta(base, head, { now: FIXED_NOW });
    const out = renderJson(report);

    expect(out).not.toContain("sha256-secret");
    expect(out).not.toContain("sha256-output");
    expect(out).toContain('"hash": "fp-');
    expect(report.drift.toolInputs[0]?.baseHashes).toEqual(["sha256-secret-old"]);
  });

  it("assigns public labels from comparison structure, not lexical hash order", () => {
    const build = (baseHash: string, headHash: string) =>
      computeDelta(
        repeatRuns("main", "aaa1111", 2, {
          evals: { e: true },
          toolInputs: [{ name: "lookup", inputsHash: baseHash, evalName: "e" }],
        }),
        repeatRuns("feat", "bbb2222", 2, {
          evals: { e: true },
          toolInputs: [{ name: "lookup", inputsHash: headHash, evalName: "e" }],
        }),
        { now: FIXED_NOW },
      );

    expect(renderJson(build("zzz", "aaa"))).toBe(renderJson(build("aaa", "zzz")));
  });

  it("preserves distinct fingerprint multiplicity when privacy classes collapse", () => {
    const base = buildRuns("main", "aaa1111", [
      {
        evals: { e: true },
        toolInputs: [{ name: "lookup", inputsHash: "A", evalName: "e" }],
      },
      {
        evals: { e: true },
        toolInputs: [{ name: "lookup", inputsHash: "B", evalName: "e" }],
      },
    ]);
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { e: true },
      toolInputs: [{ name: "lookup", inputsHash: "C", evalName: "e" }],
    });
    const parsed = JSON.parse(renderJson(computeDelta(base, head, { now: FIXED_NOW }))) as {
      drift: {
        toolInputs: Array<{
          baseHashes: string[];
          baseFrequencies: Array<{ hash: string; runs: number }>;
        }>;
      };
    };
    const input = parsed.drift.toolInputs[0];

    expect(input?.baseHashes).toHaveLength(2);
    expect(input?.baseFrequencies).toHaveLength(2);
    expect(input?.baseFrequencies.map((item) => item.runs)).toEqual([1, 1]);
  });
});
