import { describe, expect, it } from "vitest";
import { computeDelta } from "../src/analyze/delta.js";
import { renderTerminal } from "../src/report/terminal.js";
import { buildRuns, FIXED_NOW, repeatRuns } from "./helpers/records.js";

// Matches any ANSI escape sequence.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching the ESC byte
const ANSI = /\u001b\[/;

function sampleReport() {
  const base = repeatRuns("main", "aaa1111222233334444", 4, {
    evals: { "sql/join": true, "weather/forecast": true },
    tools: ["run_sql", "done"],
    skills: ["unit-conversion"],
    costUsd: 0.05,
  });
  const head = buildRuns("feat/new-planner", "bbb2222333344445555", [
    { evals: { "sql/join": false, "weather/forecast": true }, tools: ["run_sql", "done"], costUsd: 0.06 },
    { evals: { "sql/join": false, "weather/forecast": true }, tools: ["run_sql", "done"], costUsd: 0.061 },
    { evals: { "sql/join": false, "weather/forecast": true }, tools: ["run_sql", "done"], costUsd: 0.062 },
    { evals: { "sql/join": false, "weather/forecast": true }, tools: ["run_sql", "done"], costUsd: 0.063 },
  ]);
  return computeDelta(base, head, { now: FIXED_NOW });
}

describe("renderTerminal", () => {
  it("emits no ANSI codes with color:false", () => {
    const out = renderTerminal(sampleReport(), { color: false });
    expect(out).not.toMatch(ANSI);
  });

  it("emits ANSI codes when color is enabled", () => {
    const out = renderTerminal(sampleReport(), { color: true });
    expect(out).toMatch(ANSI);
  });

  it("contains the key report lines in plain output", () => {
    const out = renderTerminal(sampleReport(), { color: false });
    expect(out).toContain("diff0 main...feat/new-planner");
    expect(out).toContain("RED");
    expect(out).toContain("EVALS");
    expect(out).toContain("sql/join");
    expect(out).toContain("base 4/4");
    expect(out).toContain("head 0/4");
    expect(out).toContain("REGRESSED");
    expect(out).toContain("BEHAVIORAL DRIFT");
    expect(out).toContain("COST & PERFORMANCE");
    expect(out).toContain("cost/session");
    expect(out).toContain("PER-RUN RAW SUMMARIES");
    expect(out).toContain("run 1: 1/2 evals passed");
    expect(out).toContain("LLM runs are nondeterministic; treat proportions, not absolutes.");
  });

  it("surfaces caveats and skill drift with `X of N runs` language", () => {
    const out = renderTerminal(sampleReport(), { color: false });
    expect(out).toContain("--runs 5");
    expect(out).toContain(
      "unit-conversion (unattributed): loaded in 4 of 4 base runs -> 0 of 4 head runs",
    );
  });

  it("never leaks undefined/NaN", () => {
    const out = renderTerminal(sampleReport(), { color: false });
    expect(out).not.toMatch(/\bundefined\b/);
    expect(out).not.toMatch(/\bNaN\b/);
  });

  it("shows exceeded performance budgets only when a budget is exceeded", () => {
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { e: true },
      tokens: { input: 100, output: 100 },
      durationMs: 1_000,
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { e: true },
      tokens: { input: 100, output: 250 },
      durationMs: 2_500,
    });
    const exceeded = renderTerminal(computeDelta(base, head, { now: FIXED_NOW }), {
      color: false,
    });
    const unchanged = renderTerminal(
      computeDelta(base, base.map((run) => ({ ...run, ref: "feat" })), { now: FIXED_NOW }),
      { color: false },
    );

    expect(exceeded).toContain("EXCEEDED PERFORMANCE BUDGETS");
    expect(exceeded).toContain("output tokens delta +150% exceeds +100% threshold");
    expect(exceeded).toContain("duration delta +150% exceeds +100% threshold");
    expect(unchanged).not.toContain("EXCEEDED PERFORMANCE BUDGETS");
  });

  it("separates the unknown actual sandbox from the host default candidate", () => {
    const runs = repeatRuns("main", "aaa1111", 2, {
      evals: { e: true },
      sandboxBackend: "unknown",
    });
    const report = computeDelta(runs, runs.map((run) => ({ ...run, ref: "feat" })), {
      now: FIXED_NOW,
      sandboxInferred: false,
      hostDefaultSandboxCandidate: "docker",
    });
    const out = renderTerminal(report, { color: false });

    expect(out).toContain("actual sandbox unknown");
    expect(out).toContain("host default candidate docker");
    expect(out).not.toContain("sandbox docker (inferred)");
  });
});

describe("renderTerminal 100-column fit", () => {
  // Mirrors the demo-agent drift scenario: long alternating tool sequence on
  // base, refs long enough to push the one-line title past the budget.
  function demoScaleReport() {
    const longSeq = [
      "load_skill", "run_sql", "load_skill", "run_sql",
      "load_skill", "run_sql", "load_skill", "run_sql",
    ];
    const base = repeatRuns("main", "aaa1111222233334444", 3, {
      evals: { "revenue/total-revenue": true, "revenue/uses-sql-tool": true },
      tools: longSeq,
      skills: ["revenue-definitions"],
      costUsd: null,
    });
    const head = repeatRuns("tighten-instructions", "bbb2222333344445555", 3, {
      evals: { "revenue/total-revenue": true, "revenue/uses-sql-tool": true },
      tools: ["run_sql", "run_sql", "run_sql", "run_sql"],
      skills: [],
      costUsd: null,
    });
    return computeDelta(base, head, { now: FIXED_NOW });
  }

  it("keeps every line within 96 columns", () => {
    const out = renderTerminal(demoScaleReport(), { color: false });
    for (const line of out.split("\n")) {
      expect(line.length, `line overflows 96 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(
        96,
      );
    }
  });

  it("wraps statistical eval evidence within 96 columns", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { e: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { e: false } });
    const out = renderTerminal(computeDelta(base, head, { now: FIXED_NOW }), { color: false });
    expect(out).toContain("Fisher raw p=");
    for (const line of out.split("\n")) {
      expect(line.length, `line overflows 96 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(
        96,
      );
    }
  });

  it("keeps the verdict headline on its own unwrapped line when the title is long", () => {
    const out = renderTerminal(demoScaleReport(), { color: false });
    const lines = out.split("\n");
    expect(lines[0]).toBe("diff0 main...tighten-instructions  YELLOW");
    expect(lines[1]).toMatch(/^ {2}— No confirmed eval regressions/);
  });

  it("keeps a short title on a single line", () => {
    const out = renderTerminal(sampleReport(), { color: false });
    expect(out.split("\n")[0]).toMatch(/^diff0 main\.\.\.feat\/new-planner {2}RED — /);
  });

  it("wraps long tool sequences with a hanging indent, preserving every call", () => {
    const out = renderTerminal(demoScaleReport(), { color: false });
    const lines = out.split("\n");
    const start = lines.findIndex((l) => l.includes("base most common"));
    expect(start).toBeGreaterThan(-1);
    // Continuation lines are indented 6 spaces and start on a tool name.
    expect(lines[start + 1]).toMatch(/^ {6}(load_skill|run_sql)/);
    // Full fidelity: all 8 calls survive the wrap (joined across lines).
    const headStart = lines.findIndex((line, index) => index > start && line.includes("head most common"));
    const joined = lines.slice(start, headStart).join(" ").replace(/\s+/g, " ");
    const arrows = joined.split(" -> ").length - 1;
    expect(arrows).toBe(7);
  });

  it("neutralizes terminal controls and preserves long semantic labels within 96 columns", () => {
    const bad = `eval/${"x".repeat(140)}|cell\n\n@team\u001b[31mPWN`;
    const base = repeatRuns("main", "aaa1111", 3, {
      evals: { [bad]: true },
      tools: [bad],
      skills: [bad],
      model: `model/${"b".repeat(140)}`,
    });
    const head = repeatRuns("feat", "bbb2222", 3, {
      evals: { [bad]: true },
      tools: ["other"],
      model: `model/${"h".repeat(140)}`,
    });
    const out = renderTerminal(
      computeDelta(base, head, {
        now: FIXED_NOW,
        gitDiffStat: {
          files: [{ path: `apps/${"deep/".repeat(30)}file.ts`, insertions: 1, deletions: 0 }],
          summary: `${"long-summary-".repeat(15)}changed`,
        },
      }),
      { color: false },
    );

    expect(out).not.toContain("\u001b");
    expect(out).toContain("\\x0a");
    expect(out).toContain("base most common");
    expect(out).toContain("head most common");
    for (const line of out.split("\n")) {
      expect(line.length, `line overflows 96 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(96);
    }
  });
});
