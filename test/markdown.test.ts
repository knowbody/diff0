import { describe, expect, it } from "vitest";
import { computeDelta } from "../src/analyze/delta.js";
import type { DeltaReport } from "../src/analyze/types.js";
import { REPORT_MARKER, renderMarkdown } from "../src/report/markdown.js";
import { buildRuns, FIXED_NOW, repeatRuns } from "./helpers/records.js";

function allGreenReport(): DeltaReport {
  const base = repeatRuns("main", "aaa1111222233334444", 3, {
    evals: { "weather/forecast": true, "sql/join": true },
    tools: ["get_weather", "run_sql", "done"],
    skills: ["unit-conversion"],
    costUsd: 0.03,
  });
  const head = repeatRuns("feat/cleanup", "bbb2222333344445555", 3, {
    evals: { "weather/forecast": true, "sql/join": true },
    tools: ["get_weather", "run_sql", "done"],
    skills: ["unit-conversion"],
    costUsd: 0.031,
  });
  return computeDelta(base, head, {
    now: FIXED_NOW,
    gitDiffStat: {
      files: [{ path: "README.md", insertions: 5, deletions: 1 }],
      summary: "1 file changed, 5 insertions(+), 1 deletion(-)",
    },
  });
}

/** The product-pitch example: no eval regressions, but a skill drop + cost +38%. */
function driftOnlyYellowReport(): DeltaReport {
  const base = buildRuns("main", "aaa1111222233334444", [
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "convert_units", "done"],
      skills: ["unit-conversion"],
      costUsd: 0.029,
    },
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "convert_units", "done"],
      skills: ["unit-conversion"],
      costUsd: 0.03,
    },
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "convert_units", "done"],
      skills: ["unit-conversion"],
      costUsd: 0.031,
    },
  ]);
  const head = buildRuns("feat/tighter-prompt", "bbb2222333344445555", [
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "done"],
      skills: [],
      costUsd: 0.04,
      tokens: { input: 1150, output: 210 },
      durationMs: 13100,
    },
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "done"],
      skills: [],
      costUsd: 0.0414,
      tokens: { input: 1150, output: 210 },
      durationMs: 13100,
    },
    {
      evals: { "weather/forecast": true, "weather/brooklyn": true },
      tools: ["get_weather", "convert_units", "done"],
      skills: ["unit-conversion"],
      costUsd: 0.043,
      tokens: { input: 1150, output: 210 },
      durationMs: 13100,
    },
  ]);
  return computeDelta(base, head, {
    now: FIXED_NOW,
    costSource: "gateway",
    gitDiffStat: {
      files: [
        { path: "agent/prompts.ts", insertions: 12, deletions: 4 },
        { path: "agent/tools.ts", insertions: 3, deletions: 1 },
      ],
      summary: "2 files changed, 15 insertions(+), 5 deletions(-)",
    },
  });
}

function regressionRedReport(): DeltaReport {
  // Four runs keep the regression significant after the unchanged weather
  // eval participates in the predetermined two-hypothesis Holm family.
  const base = repeatRuns("main", "aaa1111222233334444", 4, {
    evals: { "sql/join": true, "weather/forecast": true },
    tools: ["run_sql", "done"],
    costUsd: 0.05,
  });
  const head = repeatRuns("feat/new-planner", "bbb2222333344445555", 4, {
    evals: { "sql/join": false, "weather/forecast": true },
    tools: ["run_sql", "run_sql", "done"],
    costUsd: 0.052,
  });
  return computeDelta(base, head, {
    now: FIXED_NOW,
    gitDiffStat: {
      files: [{ path: "agent/planner.ts", insertions: 40, deletions: 12 }],
      summary: "1 file changed, 40 insertions(+), 12 deletions(-)",
    },
  });
}

function flakyMixedReport(): DeltaReport {
  const base = buildRuns("main", "aaa1111222233334444", [
    { evals: { "flaky/head": true, "flaky/both": true, "was/failing": false, "old/eval": true }, costUsd: null, model: "gpt-5" },
    { evals: { "flaky/head": true, "flaky/both": false, "was/failing": false, "old/eval": true }, costUsd: null, model: "gpt-5" },
    { evals: { "flaky/head": true, "flaky/both": true, "was/failing": false, "old/eval": true }, costUsd: null, model: "gpt-5" },
  ]);
  const head = buildRuns("feat/model-swap", "bbb2222333344445555", [
    { evals: { "flaky/head": true, "flaky/both": false, "was/failing": true, "new/eval": true }, costUsd: null, model: "claude-opus-4" },
    { evals: { "flaky/head": false, "flaky/both": true, "was/failing": true, "new/eval": true }, costUsd: null, model: "claude-opus-4" },
    { evals: { "flaky/head": false, "flaky/both": true, "was/failing": true, "new/eval": true }, costUsd: null, model: "claude-opus-4" },
  ]);
  return computeDelta(base, head, { now: FIXED_NOW });
}

const SCENARIOS: Array<[string, () => DeltaReport]> = [
  ["all-green", allGreenReport],
  ["drift-only-yellow", driftOnlyYellowReport],
  ["regression-red", regressionRedReport],
  ["flaky-mixed", flakyMixedReport],
];

describe("renderMarkdown snapshots", () => {
  for (const [name, build] of SCENARIOS) {
    it(`renders the ${name} scenario`, () => {
      expect(renderMarkdown(build())).toMatchSnapshot();
    });
  }
});

describe("renderMarkdown structure", () => {
  it("starts every report with the upsert marker comment", () => {
    for (const [, build] of SCENARIOS) {
      const md = renderMarkdown(build());
      expect(md.startsWith(`${REPORT_MARKER}\n`)).toBe(true);
    }
  });

  it("always includes the collapsible full-details block", () => {
    for (const [, build] of SCENARIOS) {
      const md = renderMarkdown(build());
      expect(md).toContain("<details>");
      expect(md).toContain("<summary><strong>Full comparison details</strong></summary>");
      expect(md).toContain("#### Per-run summaries");
      expect(md).toContain("</details>");
    }
  });

  it("never leaks undefined/NaN into any scenario", () => {
    for (const [name, build] of SCENARIOS) {
      const md = renderMarkdown(build());
      expect(md, `scenario ${name}`).not.toMatch(/\bundefined\b/);
      expect(md, `scenario ${name}`).not.toMatch(/\bNaN\b/);
      expect(md, `scenario ${name}`).not.toMatch(/\bnull\b/);
    }
  });

  it("always carries the nondeterminism footer", () => {
    for (const [, build] of SCENARIOS) {
      expect(renderMarkdown(build())).toContain(
        "LLM runs are nondeterministic; treat proportions, not absolutes.",
      );
    }
  });

  it("verdict emoji and statuses: regression is visually distinct from flaky", () => {
    const red = renderMarkdown(regressionRedReport());
    expect(red).toContain("🔴");
    expect(red).toContain("**REGRESSED**");
    const flaky = renderMarkdown(flakyMixedReport());
    expect(flaky).toContain("🟡 lower pass rate (inconclusive)");
    expect(flaky).toContain("🟠 flaky (base + head)");
    expect(flaky).not.toContain("REGRESSED");
  });

  it("renders an operational red gate without hiding inconclusive Fisher/Holm evidence", () => {
    const base = repeatRuns("main", "aaa1111", 3, { evals: { alpha: true, beta: true } });
    const head = repeatRuns("feat", "bbb2222", 3, { evals: { alpha: false, beta: false } });
    const md = renderMarkdown(computeDelta(base, head, { now: FIXED_NOW }));

    expect(md).toContain("🔴");
    expect(md).toContain("2 operational eval regressions");
    expect(md).toContain("🟡 lower pass rate (inconclusive)");
    expect(md).toContain("Fisher raw p=0.05 · Holm p=0.1");
    expect(md).not.toContain("**REGRESSED**");
  });

  it("renders missing-* statuses as added/removed", () => {
    const md = renderMarkdown(flakyMixedReport());
    expect(md).toContain("➕ added");
    expect(md).toContain("➖ removed");
  });

  it("recommends --runs 5 on borderline results at N<5", () => {
    expect(renderMarkdown(regressionRedReport())).toContain("--runs 5");
    expect(renderMarkdown(flakyMixedReport())).toContain("--runs 5");
    expect(renderMarkdown(allGreenReport())).not.toContain("--runs 5");
  });

  it("shows the validity warning block when refs mismatch", () => {
    const md = renderMarkdown(flakyMixedReport());
    expect(md).toContain("⚠️ Comparison validity warnings");
    expect(md).toContain("model differs between refs: base=gpt-5, head=claude-opus-4");
  });

  it("labels inferred sandbox backends and unavailable cost honestly", () => {
    const md = renderMarkdown(flakyMixedReport());
    expect(md).toContain("sandbox docker (inferred)");
    expect(md).toContain("comparison cost unavailable");
    expect(md).not.toContain("$0.00 ");
  });

  it("drift section uses `X of N runs` language and the pitch numbers", () => {
    const md = renderMarkdown(driftOnlyYellowReport());
    expect(md).toContain("loaded in 3 of 3 base runs → 1 of 3 head runs");
    expect(md).toContain("+38%");
  });

  it("deduplicates repeated evidence in the default view", () => {
    const report = driftOnlyYellowReport();
    const skill = report.drift.skills[0];
    if (skill === undefined) throw new Error("expected skill drift fixture");
    report.drift.skills = [
      { ...skill, evalName: "weather/forecast" },
      { ...skill, evalName: "weather/brooklyn" },
    ];

    const defaultView = renderMarkdown(report).split("<details>")[0];
    expect(defaultView).toContain(
      "| Skill `unit-conversion` | 3/3 runs | 1/3 runs | 2 evals · inconclusive |",
    );
    expect(defaultView?.match(/Skill `unit-conversion`/g)).toHaveLength(1);
  });

  it("uses precise summary labels and puts agent changes before lower-level drift", () => {
    const md = renderMarkdown(driftOnlyYellowReport());
    const defaultView = md.split("<details>")[0];

    expect(defaultView).toContain("Evals passing every run");
    expect(defaultView).toContain("Tool calls / run (agents excluded)");
    expect(md).toContain("Uncached input tokens");
    expect(md).toContain("Tool calls (agents excluded)");
    expect(defaultView).toContain("### Observed behavioral differences");

    const skillIndex = defaultView.indexOf("Skill `unit-conversion`");
    const toolPathIndex = defaultView.indexOf("Tool path");
    expect(skillIndex).toBeGreaterThan(-1);
    expect(toolPathIndex).toBeGreaterThan(skillIndex);
  });

  it("states confirmed behavioral drift directly in the warning", () => {
    const base = buildRuns(
      "main",
      "aaa1111",
      Array.from({ length: 5 }, (_, index) => ({
        evals: { revenue: true },
        subagentCalls: [{ name: "reporter", evalName: "revenue" }],
        finalOutputs: { revenue: { hash: `base-${index % 2}` } },
      })),
    );
    const head = buildRuns(
      "feat",
      "bbb2222",
      Array.from({ length: 5 }, (_, index) => ({
        evals: { revenue: true },
        finalOutputs: { revenue: { hash: `head-${index % 2}` } },
      })),
    );
    const report = computeDelta(base, head, { now: FIXED_NOW });
    const md = renderMarkdown(report);
    expect(md).toContain("Confirmed behavioral drift requires review.");
    expect(report.verdictSummary).toContain("additional behavioral differences inconclusive");
  });

  it("changed-files section carries the correlational note", () => {
    const md = renderMarkdown(driftOnlyYellowReport());
    expect(md).toContain("File attribution is correlational, not causal.");
    expect(md).toContain("`agent/prompts.ts` (+12 −4)");
  });

  it("says so explicitly when no behavioral drift was detected", () => {
    expect(renderMarkdown(allGreenReport())).toContain(
      "No behavioral drift detected across 3 runs per ref.",
    );
  });

  it("escapes table/comment injection and control bytes in untrusted names", () => {
    const bad = "evil|cell\n\n@team\u001b[31mPWN`[]<>";
    const base = repeatRuns("main", "aaa1111", 2, {
      evals: { [bad]: true },
      tools: [bad],
      skills: [bad],
    });
    const head = repeatRuns("feat", "bbb2222", 2, {
      evals: { [bad]: true },
      tools: ["other"],
    });
    const md = renderMarkdown(computeDelta(base, head, { now: FIXED_NOW }));

    expect(md).not.toContain("\u001b");
    expect(md).not.toContain("\n@team");
    expect(md).toContain("evil\\|cell\\x0a\\x0a&#64;teamPWN");
    expect(md).toContain("&#96;");
    expect(md).toContain("\\[");
    expect(md).toContain("&lt;&gt;");
  });
});
