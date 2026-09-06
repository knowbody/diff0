/** Contributor-only live calibration. Raw fingerprints stay in memory. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { applyPricing } from "../dist/collect/pricing.js";
import { computeDelta } from "../dist/index.js";
import { renderJson, renderMarkdown } from "../dist/reporters.js";
import { runComparison } from "../dist/runner.js";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    evals: { type: "string" },
    "app-dir": { type: "string", default: "." },
    runs: { type: "string", default: "10" },
    "sample-sizes": { type: "string", default: "3,5,10" },
    "max-spend": { type: "string" },
    timeout: { type: "string", default: "90000" },
    "report-dir": { type: "string" },
    "reference-module": { type: "string" },
  },
});
const runs = Number(values.runs);
const sizes = values["sample-sizes"].split(",").map(Number);
const timeout = Number(values.timeout);
if (
  !values.repo ||
  !values.base ||
  !values.head ||
  !values["report-dir"] ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  !Number.isInteger(timeout) ||
  timeout < 1 ||
  sizes.some((n) => !Number.isInteger(n) || n < 1 || n > runs)
) {
  throw new Error(
    "Supply --repo, --base, --head, --report-dir, and positive runs/sample sizes (sizes <= runs).",
  );
}
const cap = values["max-spend"] === undefined ? undefined : Number(values["max-spend"]);
if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0))
  throw new Error("Invalid --max-spend");
const reference = values["reference-module"]
  ? (await import(pathToFileURL(resolve(values["reference-module"])).href)).computeDelta
  : undefined;
const started = Date.now();
const collected = await runComparison({
  repoPath: resolve(values.repo),
  baseRef: values.base,
  headRef: values.head,
  appDir: values["app-dir"],
  runs,
  noCache: true,
  installMode: "scripts-off",
  maxConcurrency: 1,
  timeoutMs: timeout,
  evalFilter: values.evals ? values.evals.split(",") : [],
  ...(cap === undefined ? {} : { maxSpendUsd: cap }),
  onProgress: (message) => process.stderr.write(`${message}\n`),
});
const wallTimeMs = Date.now() - started;
const priced = applyPricing([...collected.baseRuns, ...collected.headRuns]);
const base = priced.records.slice(0, runs);
const head = priced.records.slice(runs);
const options = {
  sandboxInferred: false,
  hostDefaultSandboxCandidate: collected.meta.hostDefaultSandboxCandidate,
  validityMismatches: collected.meta.validityMismatches,
  ...(priced.costSource === "unavailable" ? {} : { costSource: priced.costSource }),
};
const full = computeDelta(base, head, options);
const directory = resolve(values["report-dir"]);
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/full.json`, renderJson(full));
await writeFile(`${directory}/full.md`, renderMarkdown(full));
const trials = [];
for (const n of sizes) {
  // Disjoint blocks within each size. Sizes reuse observations: not independent experiments.
  for (let start = 0; start + n <= runs; start += n) {
    const b = base.slice(start, start + n),
      h = head.slice(start, start + n);
    const report = computeDelta(b, h, options);
    const old = reference?.(b, h, options);
    trials.push({
      runsPerRef: n,
      block: start / n + 1,
      verdict: report.verdict,
      violations: report.enforcement.violations.map((v) => v.category),
      evals: report.evals.map((e) => ({
        name: e.name,
        basePassed: e.basePassed,
        headPassed: e.headPassed,
      })),
      costUsd: report.meta.totalComparisonCostUsd,
      ...(old
        ? {
            referenceVerdict: old.verdict,
            referenceViolations: old.enforcement.violations.map((v) => v.category),
          }
        : {}),
    });
  }
}
const summary = {
  kind:
    collected.meta.baseSha === collected.meta.headSha
      ? "same-commit-control"
      : "changed-ref-comparison",
  baseSha: collected.meta.baseSha,
  headSha: collected.meta.headSha,
  model: full.meta.base.model,
  eveVersion: full.meta.base.eveVersion,
  wallTimeMs,
  suiteRuns: runs * 2,
  totalCostUsd: full.meta.totalComparisonCostUsd,
  note: "Sample sizes reuse a fixed pool. Blocks are disjoint within each size; sizes are not independent. This is a small diagnostic, not a population false-alert rate or a stopping rule.",
  trials,
};
await writeFile(`${directory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
