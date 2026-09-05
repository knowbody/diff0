import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeDelta, type RunRecord, violatesEnforcement } from "@knowbody/diff0";
import { summaryToRunRecord } from "@knowbody/diff0/eve";
import {
  type PublicReport,
  renderJson,
  renderMarkdown,
  renderTerminal,
  toPublicReport,
} from "@knowbody/diff0/reporters";
import { type CompareRefsOptions, compareRefs } from "@knowbody/diff0/runner";

const records: { base: RunRecord[]; head: RunRecord[] } = JSON.parse(
  readFileSync(new URL("./records.json", import.meta.url), "utf8"),
);
const report = computeDelta(records.base, records.head, {
  sandboxInferred: false,
  now: "2026-09-05T00:00:00.000Z",
});
const before = structuredClone(report);
const published: PublicReport = toPublicReport(report);

deepStrictEqual(report, before, "Publication must not mutate the internal evidence");
equal(JSON.stringify(published).includes("private-"), false, "Fingerprint leaked");
deepStrictEqual(published, JSON.parse(renderJson(report)));
ok(report.drift.toolInputs.length > 0, "Missing tool-input drift");
match(JSON.stringify(report), /private-base/, "Internal evidence should retain fingerprints");
equal(violatesEnforcement(report, ["behavioral-drift"]), true);
match(renderMarkdown(report), /lookup/);
match(renderTerminal(report, { color: false }), /lookup/);

const normalized = summaryToRunRecord(
  { results: [{ id: "smoke", verdict: "passed" }] },
  {
    ref: "main",
    commitSha: "aaa1111",
    runIndex: 0,
    eveVersion: "0.47.5",
    sandboxBackend: "unknown",
  },
);
equal(normalized.evalResults[0]?.passed, true);
equal(normalized.costUsd, null);

// Exercise the installed runner's validation without executing Git or Eve.
const options: CompareRefsOptions = {
  repoPath: ".",
  appDir: ".",
  baseRef: "main",
  headRef: "HEAD",
  runs: 0,
  evalFilter: [],
};
await rejects(compareRefs(options), /runs must be a positive integer/);

console.log(JSON.stringify({ verdict: report.verdict, schemaVersion: published.schemaVersion }));
