import { minimatch } from "minimatch";

/** App-owned verification policy shared by station checks and CI contract tests. */
export const VERIFICATION_CHECKS = {
  typecheck: "pnpm typecheck",
  lint: "pnpm lint",
  unit: "pnpm test",
  integration: "pnpm test:integration",
  build: "pnpm build",
  package: "pnpm test:package",
  "action-bundle": "pnpm action:build && git diff --exit-code -- action/dist",
  "station-runtime": "pnpm agent:test:runtime",
} as const;

/** Each file is one bounded hosted step; CI still executes the full integration suite. */
export const HOSTED_INTEGRATION_SCENARIOS = {
  "integration-adapter": "src/collect/adapter.integration.test.ts",
  "integration-cli": "src/collect/cli.integration.test.ts",
  "integration-drift": "src/collect/drift.integration.test.ts",
  "integration-calibration-control": "test/calibration-control.integration.test.ts",
  "integration-calibration-regression": "test/calibration-regression.integration.test.ts",
} as const;

export const BASE_CHECK_IDS = [
  "typecheck",
  "lint",
  "unit",
  "integration",
  "build",
  "package",
] as const;

export const BEHAVIOR_COMPARISON_PATTERNS = [
  "src/**",
  "action/**",
  "scripts/action-*",
  "scripts/build-action.mjs",
  "fixtures/demo-agent/agent/**",
  "fixtures/demo-agent/evals/**",
  "fixtures/demo-agent/package.json",
  "fixtures/demo-agent/pnpm-lock.yaml",
  "fixtures/demo-agent/tsconfig*.json",
  "prices.json",
  "package.json",
  "pnpm-lock.yaml",
] as const;

export function requiresBehaviorComparison(paths: readonly string[]): boolean {
  return paths.some((path) =>
    BEHAVIOR_COMPARISON_PATTERNS.some((pattern) => minimatch(path, pattern, { dot: true })),
  );
}

/** Local Eve retry proof cannot run in hosted stations, whose local backends are pruned. */
export const CI_ONLY_CHECK_IDS = ["station-runtime"] as const;

export function verificationPlan(
  paths: readonly string[],
  baseSha: string,
): Array<{ id: string; command: string }> {
  if (!/^[a-f0-9]{40}$/.test(baseSha))
    throw new Error("Verification requires an immutable base SHA.");
  const checks: Array<{ id: string; command: string }> = BASE_CHECK_IDS.flatMap((id) =>
    id === "integration"
      ? Object.entries(HOSTED_INTEGRATION_SCENARIOS).map(([scenario, file]) => ({
          id: scenario,
          command: `pnpm exec vitest run ${file}`,
        }))
      : [{ id, command: VERIFICATION_CHECKS[id] }],
  );
  if (requiresBehaviorComparison(paths))
    checks.push(
      { id: "action-bundle", command: VERIFICATION_CHECKS["action-bundle"] },
      {
        id: "demo-comparison",
        command: `DIFF0_DEMO_MODEL=mock node dist/cli.js run --repo . --app-dir fixtures/demo-agent --base '${baseSha}' --head HEAD --runs 3 --fail-on drift`,
      },
    );
  return checks;
}
