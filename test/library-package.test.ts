import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { buildRuns } from "./helpers/records.js";

it("exposes usable ESM and TypeScript APIs from the published artifact", () => {
  const root = resolve(import.meta.dirname, "..");
  const scratch = mkdtempSync(join(tmpdir(), "diff0-consumer-"));
  try {
    execFileSync("pnpm", ["build"], { cwd: root, stdio: "pipe" });
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as Array<{ filename: string }>;
    const artifact = packed[0];
    if (artifact === undefined) throw new Error("npm pack returned no artifact");
    execFileSync("tar", ["-xzf", join(scratch, artifact.filename), "-C", scratch]);
    const modules = join(scratch, "node_modules");
    mkdirSync(join(modules, "@knowbody"), { recursive: true });
    symlinkSync(join(scratch, "package"), join(modules, "@knowbody", "diff0"));
    // Use installed dependencies, but resolve diff0 itself only from the tarball.
    symlinkSync(join(root, "node_modules"), join(scratch, "package", "node_modules"));
    const base = buildRuns(
      "main",
      "aaa1111",
      Array.from({ length: 3 }, () => ({
        evals: { smoke: true },
        toolInputs: [{ name: "lookup", inputsHash: "private-base", evalName: "smoke" }],
      })),
    );
    const head = buildRuns(
      "topic",
      "bbb2222",
      Array.from({ length: 3 }, () => ({
        evals: { smoke: true },
        toolInputs: [{ name: "lookup", inputsHash: "private-head", evalName: "smoke" }],
      })),
    );
    writeFileSync(join(scratch, "records.json"), JSON.stringify({ base, head }));
    const consumer = `
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert/strict';
import { computeDelta, violatesEnforcement, type RunRecord } from '@knowbody/diff0';
import { compareRefs, runComparison, runEstimate, type CompareRefsOptions } from '@knowbody/diff0/runner';
import { renderJson, renderMarkdown, renderTerminal, toPublicReport, type PublicReport } from '@knowbody/diff0/reporters';
import { summaryToRunRecord, EveCliAdapter } from '@knowbody/diff0/eve';
const records: { base: RunRecord[]; head: RunRecord[] } = JSON.parse(readFileSync(new URL('./records.json', import.meta.url), 'utf8'));
const report = computeDelta(records.base, records.head, { sandboxInferred: false, now: '2026-09-05T00:00:00.000Z' });
const before = JSON.stringify(report);
const published: PublicReport = toPublicReport(report);
const options: CompareRefsOptions = { repoPath: '.', appDir: '.', baseRef: 'main', headRef: 'HEAD', runs: 3, evalFilter: [] };
if (!options || typeof compareRefs !== 'function' || typeof runComparison !== 'function' || typeof runEstimate !== 'function' || typeof summaryToRunRecord !== 'function' || !(new EveCliAdapter())) throw new Error('Missing export');
if (JSON.stringify(report) !== before) throw new Error('Report was mutated');
if (JSON.stringify(published).includes('private-')) throw new Error('Fingerprint leaked');
deepStrictEqual(published, JSON.parse(renderJson(report)));
if (report.drift.toolInputs.length === 0 || !before.includes('private-base')) throw new Error('Missing evidence');
if (!violatesEnforcement(report, ['behavioral-drift'])) throw new Error('Missing enforcement');
if (!renderMarkdown(report).length || !renderTerminal(report, { color: false }).length) throw new Error('Empty renderer');
console.log(JSON.stringify({ verdict: report.verdict, schemaVersion: published.schemaVersion }));
`;
    writeFileSync(join(scratch, "consumer.mts"), consumer);
    execFileSync(
      join(root, "node_modules", ".bin", "tsc"),
      [
        "consumer.mts",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2022",
        "--strict",
        "--skipLibCheck",
        "--types",
        "node",
        "--typeRoots",
        join(root, "node_modules", "@types"),
      ],
      { cwd: scratch, stdio: "pipe" },
    );
    const result = execFileSync(process.execPath, ["consumer.mjs"], {
      cwd: scratch,
      encoding: "utf8",
    });
    expect(JSON.parse(result)).toEqual({ verdict: "yellow", schemaVersion: 4 });
    expect(readFileSync(join(scratch, "package", "docs", "library-api.md"), "utf8")).toContain(
      "compareRefs",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
