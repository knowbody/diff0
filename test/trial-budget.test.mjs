import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { codingAttemptPassed } from "../scripts/trial-checks.mjs";

const state = vi.hoisted(() => ({ requests: 0, reports: [] }));
vi.mock("ai", async (original) => ({
  ...(await original()),
  createGateway: () => () => "mock-model",
  generateText: async (options) => {
    await options.prepareStep();
    state.requests++;
    throw new Error("Timeout after request was sent; terminal billing metadata unavailable");
  },
}));
vi.mock("node:fs", async (original) => {
  const fs = await original();
  return {
    ...fs,
    writeFileSync: (path, data, ...rest) => {
      if (String(path).endsWith("results.json")) state.reports.push(JSON.parse(data));
      else fs.writeFileSync(path, data, ...rest);
    },
  };
});
const argv = process.argv;
afterEach(() => {
  process.argv = argv;
  vi.unstubAllEnvs();
  vi.resetModules();
  state.requests = 0;
  state.reports = [];
});

for (const script of ["trial-station-models", "trial-coding-models"]) {
  test.skipIf(
    script === "trial-coding-models" && !process.allowedNodeEnvironmentFlags.has("--allow-net"),
  )(`${script} stops paid requests after uncertain billing`, async () => {
    process.argv = [process.execPath, "trial"];
    vi.stubEnv("AI_GATEWAY_API_KEY", "fake-key-no-network");
    await expect(import(`../scripts/${script}.mjs`)).rejects.toThrow(
      /unknown cost|cost unavailable/,
    );
    expect(state.requests).toBe(1);
    const report = state.reports.at(-1);
    expect(report.unknownCost).toBe(true);
    expect(report.records[0].costUsd).toBeNull();
  });
}

test("coding acceptance gate rejects contradictory approvals and publication claims", () => {
  const records = JSON.parse(
    readFileSync(new URL("../docs/luna-coding-trial.json", import.meta.url), "utf8"),
  ).records;
  for (const record of records) {
    const step = record.attempts[0];
    const check = (impl, review) => codingAttemptPassed({ ...step, implementation: impl, review });
    expect(check(step.implementation, step.review)).toBe(true);
    expect(
      check(
        { ...step.implementation, output: { ...step.implementation.output, pushed: true } },
        step.review,
      ),
    ).toBe(false);
    expect(
      check(step.implementation, {
        ...step.review,
        output: { ...step.review.output, blocking_findings: ["blocker"] },
      }),
    ).toBe(false);
    expect(
      check(step.implementation, {
        ...step.review,
        output: { ...step.review.output, criteria_results: [{ pass: false }] },
      }),
    ).toBe(false);
    expect(
      check(step.implementation, {
        ...step.review,
        output: { ...step.review.output, criteria_results: [] },
      }),
    ).toBe(false);
  }
});
