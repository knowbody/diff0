import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createShowcase } from "../lib/showcase-model.ts";

const snapshot = JSON.parse(
  readFileSync(new URL("../content/showcase.json", import.meta.url), "utf8"),
);

test("preserves the captured source report values in web and OG evidence", () => {
  const model = createShowcase(snapshot);
  assert.deepEqual(
    model.metrics.map(({ base, head, delta }) => ({ base, head, delta })),
    [
      { base: "6 (6–10)", head: "6", delta: "+0%" },
      { base: "1,017 (941–1,481)", head: "675 (654–714)", delta: "-34%" },
      { base: "20.2s (19.0s–27.2s)", head: "11.8s (10.8s–12.5s)", delta: "-41%" },
    ],
  );
  assert.equal(model.ogEvidence, "reporter: 10/10 -> 0/10 · output -34% · duration -41%");
  assert.equal(model.ogTitle, "real-model drift · no confirmed regression");
  assert.equal(
    model.sourceUrl,
    "https://github.com/knowbody/diff0/pull/15#issuecomment-5539022795",
  );
  assert.equal(model.snapshotLabel, "Captured 2026-09-04 · diff0 v0.1.3");
  assert.deepEqual(model.evalObservationTotal, { passed: 60, total: 60 });
  assert.deepEqual(model.evalsPassingEveryRun, { base: "3/3", head: "3/3", change: "unchanged" });
});

test("derives observation and complete-coverage summaries from numeric eval records", () => {
  const changed = structuredClone(snapshot);
  changed.evals[0].base = { passed: 1, total: 1, score: 1 };
  const model = createShowcase(changed);
  assert.equal(model.evalsPassingEveryRun.base, "2/3");
  assert.equal(model.evalPasses.base, "21 / 21");
  assert.equal(model.evalsPassingEveryRun.change, "+1");
});

test("rejects malformed counts, missing metrics, invalid ranges, and unrelated provenance at build time", () => {
  for (const edit of [
    (s) => {
      s.runsPerRef = 0;
    },
    (s) => {
      s.evals[0].head.passed = 11;
    },
    (s) => {
      s.metrics.outputTokens.base.median = Number.NaN;
    },
    (s) => {
      delete s.metrics.durationSeconds;
    },
    (s) => {
      s.metrics.durationSeconds.base.min = 100;
    },
    (s) => {
      s.sourceUrl = "https://example.com/report";
    },
    (s) => {
      s.subagent.evalNames = ["missing-eval"];
    },
  ]) {
    const changed = structuredClone(snapshot);
    edit(changed);
    assert.throws(() => createShowcase(changed), /Showcase/);
  }
});

test("all headline and metadata claims follow accepted regression and unchanged snapshots", () => {
  const regression = structuredClone(snapshot);
  regression.verdict = "red";
  regression.confirmedEvalRegressions = 1;
  regression.evals[0].head.passed = 0;
  regression.subagent.headUsedRuns = 5;
  const changed = createShowcase(regression);
  assert.equal(changed.comparisonTitle, "Regression detected");
  assert.equal(changed.verdictBadge, "regression");
  assert.equal(changed.verdictIcon, "🔴");
  assert.equal(changed.evalTitle, "Eval outcomes");
  assert.doesNotMatch(changed.delegationSummary, /vanished/);
  assert.match(changed.verdictExplanation, /red verdict/);
  assert.match(changed.ogDescription, /confirmed regression/);
  assert.doesNotMatch(changed.ogDescription, /no confirmed regression/);
  const performanceRegression = createShowcase({ ...snapshot, verdict: "red" });
  assert.equal(
    performanceRegression.ogTitle,
    "real-model regression · no confirmed eval regression",
  );

  const unchanged = structuredClone(snapshot);
  unchanged.verdict = "green";
  unchanged.subagent.headUsedRuns = unchanged.subagent.baseUsedRuns;
  const stable = createShowcase(unchanged);
  assert.equal(stable.comparisonTitle, "Comparison complete");
  assert.equal(stable.verdictBadge, "clear");
  assert.equal(stable.verdictIcon, "🟢");
  assert.equal(stable.delegationTitle, "Delegation evidence");
  assert.match(stable.delegationSummary, /unchanged delegation/);
  assert.doesNotMatch(stable.verdictSummary, /drift requires review/);
  assert.throws(() => createShowcase({ ...snapshot, verdict: "green" }), /green snapshot/);
});
