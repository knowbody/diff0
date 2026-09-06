import { readFileSync } from "node:fs";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflows = {
  free: "diff0-free.yml",
  demo: "diff0.yml",
  maintenance: "eve-diff.yml",
} as const;

// These workflows use positive, simple GitHub path globs (* and **), with no
// extglobs or negation. Read the real YAML so drift in a trigger is caught.
const routes = Object.entries(workflows).map(([target, file]) => ({
  target,
  paths: parse(
    readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"),
  ).on.pull_request.paths as string[],
}));

function comparisonsFor(paths: string[]): string[] {
  return routes
    .filter((route) => paths.some((path) => route.paths.some((glob) => minimatch(path, glob))))
    .map((route) => route.target);
}

describe("comparison workflow routing", () => {
  it.each([
    ["fixtures/demo-agent/agent/instructions.md", ["free", "demo"]],
    ["fixtures/demo-agent/agent/skills/revenue-definitions.md", ["free", "demo"]],
    ["fixtures/demo-agent/agent/tools/run_sql.ts", ["free", "demo"]],
    ["fixtures/demo-agent/evals/revenue/total-revenue.eval.ts", ["free", "demo"]],
    ["fixtures/demo-agent/package.json", ["free", "demo"]],
    ["fixtures/demo-agent/pnpm-lock.yaml", ["free", "demo"]],
    ["fixtures/demo-agent/tsconfig.json", ["free", "demo"]],
    ["agent/instructions.ts", ["maintenance"]],
    ["agent/skills/triaging-issues/SKILL.md", ["maintenance"]],
    ["agent/subagents/classifier/instructions.md", ["maintenance"]],
    ["agent/lib/models.ts", ["maintenance"]],
    ["agent/extensions/github/tools/github.ts", ["maintenance"]],
    ["evals/safety/prompt-injection.eval.ts", ["maintenance"]],
    ["evals/helpers.ts", ["maintenance"]],
    ["package.json", ["maintenance"]],
    ["pnpm-lock.yaml", ["maintenance"]],
    ["package-lock.json", ["maintenance"]],
    ["yarn.lock", ["maintenance"]],
    ["bun.lock", ["maintenance"]],
    ["pnpm-workspace.yaml", ["maintenance"]],
    [".npmrc", ["maintenance"]],
    ["scripts/maintenance-relevance.mjs", ["maintenance"]],
    ["agent/tsconfig.json", ["maintenance"]],
    ["tsconfig.json", ["maintenance"]],
    ["tsconfig.build.json", []],
    ["README.md", []],
    ["agent/README.md", []],
    ["agent/COSTS.md", []],
    ["agent/SMALL-TASK-RUN.md", []],
    ["fixtures/demo-agent/README.md", []],
    ["docs/credential-free-ci.md", []],
    ["website/app/page.tsx", []],
    ["src/report/format.ts", []],
    ["src/cli.ts", []],
    ["action/dist/cli.mjs", []],
    ["test/format.test.ts", []],
    ["evals/pipeline/tiny-cost.eval.ts", []],
    [".github/workflows/diff0-free.yml", ["free"]],
    [".github/workflows/diff0.yml", ["demo"]],
    [".github/workflows/eve-diff.yml", ["maintenance"]],
    [".github/workflows/ci.yml", []],
  ] satisfies Array<[string, string[]]>)("routes %s to %j", (path, expected) => {
    expect(comparisonsFor([path])).toEqual(expected);
  });

  it("routes mixed PRs to both apps without letting docs suppress an agent change", () => {
    expect(comparisonsFor([
      "README.md",
      "fixtures/demo-agent/agent/instructions.md",
      "agent/instructions.ts",
    ])).toEqual(["free", "demo", "maintenance"]);
  });
});
