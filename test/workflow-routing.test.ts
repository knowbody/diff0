import { readdirSync, readFileSync } from "node:fs";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  BEHAVIOR_COMPARISON_PATTERNS,
  CI_ONLY_CHECK_IDS,
  HOSTED_INTEGRATION_SCENARIOS,
  VERIFICATION_CHECKS,
  verificationPlan,
} from "../agent/lib/verification.js";

const workflows = {
  free: "diff0-free.yml",
  demo: "diff0.yml",
  maintenance: "eve-diff.yml",
} as const;

// These workflows use positive, simple GitHub path globs (* and **), with no
// extglobs or negation. Read the real YAML so drift in a trigger is caught.
const routes = Object.entries(workflows).map(([target, file]) => ({
  target,
  paths: parse(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")).on
    .pull_request.paths as string[],
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
    ["package.json", ["free", "maintenance"]],
    ["pnpm-lock.yaml", ["free", "maintenance"]],
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
    ["src/report/format.ts", ["free"]],
    ["src/cli.ts", ["free"]],
    ["action/dist/cli.mjs", ["free"]],
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
    expect(
      comparisonsFor([
        "README.md",
        "fixtures/demo-agent/agent/instructions.md",
        "agent/instructions.ts",
      ]),
    ).toEqual(["free", "demo", "maintenance"]);
  });
});

describe("verification policy matches CI", () => {
  it("runs deterministic comparisons for every app-owned behavioral scope", () => {
    const free = routes.find((route) => route.target === "free");
    for (const pattern of BEHAVIOR_COMPARISON_PATTERNS) expect(free?.paths).toContain(pattern);
  });
  it("executes the named verification checks, including the CI-only runtime proof", () => {
    const workflow = parse(
      readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    );
    const commands = workflow.jobs.ci.steps
      .flatMap((step: { run?: string }) => (step.run ?? "").split("\n"))
      .map((command: string) => command.trim());
    for (const id of [
      "typecheck",
      "lint",
      "unit",
      "integration",
      "package",
      ...CI_ONLY_CHECK_IDS,
    ] as const) {
      expect(commands).toContain(VERIFICATION_CHECKS[id]);
    }
    expect(commands).toContain("pnpm action:build");
    expect(commands).toContain("git diff --exit-code -- action/dist");
    expect(
      commands.some((command: string) => command.includes("npm install --engine-strict")),
    ).toBe(true);
  });
});

it("covers every integration scenario in separate bounded hosted steps while CI runs the full suite", () => {
  const files = ["src", "test"].flatMap((directory) =>
    readdirSync(new URL(`../${directory}/`, import.meta.url), { recursive: true })
      .filter((file): file is string => typeof file === "string")
      .filter((file) => /integration\.test\.[cm]?[jt]sx?$/.test(file))
      .filter(
        (file) => !file.split(/[\\/]/).some((part) => ["node_modules", ".claude"].includes(part)),
      )
      .map((file) => `${directory}/${file}`),
  );
  expect(Object.values(HOSTED_INTEGRATION_SCENARIOS).sort()).toEqual(files.sort());
  const plan = verificationPlan([], "a".repeat(40));
  const hosted = plan.filter(({ id }) => id.startsWith("integration-"));
  expect(hosted).toHaveLength(files.length);
  for (const file of files)
    expect(hosted.map(({ command }) => command)).toContain(`pnpm exec vitest run ${file}`);
  expect(plan.map(({ command }) => command)).not.toContain(VERIFICATION_CHECKS.integration);
});
