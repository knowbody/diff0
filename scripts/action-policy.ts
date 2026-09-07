import { z } from "zod";
import { ENFORCEMENT_CATEGORIES, violatesEnforcement } from "../src/analyze/policy.js";
import type { Verdict } from "../src/analyze/types.js";
import {
  parseFailOn,
  parseNonNegativePercentage,
  parsePositiveInt,
  parseUsd,
} from "../src/options.js";
import { JSON_SCHEMA_VERSION } from "../src/report/schema.js";

type Environment = Record<string, string | undefined>;

/** Validate policy before the Action starts a comparison that may incur spend. */
export function validateActionInputs(env: Environment): void {
  parseFailOn(env.INPUT_FAIL_ON ?? "regression");
  parsePositiveInt("runs")(env.INPUT_RUNS ?? "3");
  if (!env.INPUT_BASE?.trim())
    throw new Error("the 'base' input is empty; supply it on non-PR events");
  if (env.INPUT_MAX_SPEND) parseUsd("max-spend")(env.INPUT_MAX_SPEND);
  for (const [name, key] of [
    ["max-cost-increase-pct", "INPUT_MAX_COST_INCREASE_PCT"],
    ["max-input-token-increase-pct", "INPUT_MAX_INPUT_TOKEN_INCREASE_PCT"],
    ["max-output-token-increase-pct", "INPUT_MAX_OUTPUT_TOKEN_INCREASE_PCT"],
    ["max-duration-increase-pct", "INPUT_MAX_DURATION_INCREASE_PCT"],
  ] as const) {
    const raw = env[key];
    if (raw) parseNonNegativePercentage(name)(raw);
  }
}

const enforcementReport = z.object({
  schemaVersion: z.literal(JSON_SCHEMA_VERSION),
  verdict: z.enum(["green", "yellow", "red"]),
  enforcement: z.object({
    violations: z.array(
      z.object({
        category: z.enum(ENFORCEMENT_CATEGORIES),
        reasons: z.array(z.string()),
      }),
    ),
  }),
});

export interface ActionEnforcement {
  code: number;
  message: string;
  verdict?: Verdict;
}

/** Execution failures remain failures even when the requested policy is never. */
export function executionFailure(rawCode: string | undefined): ActionEnforcement | null {
  if (rawCode === "0") return null;
  const code = rawCode !== undefined && /^[1-9]\d{0,2}$/.test(rawCode) ? Number(rawCode) : 3;
  return {
    code: code <= 255 ? code : 3,
    message: `CLI execution failed (exit ${rawCode ?? "missing"}); see the CLI output above.`,
  };
}

export function enforceActionReport(rawReport: unknown, rawPolicy: string): ActionEnforcement {
  const policy = parseFailOn(rawPolicy);
  const result = enforcementReport.safeParse(rawReport);
  if (!result.success) {
    return {
      code: 3,
      message: "JSON report has an unsupported schema or invalid verdict/enforcement data.",
    };
  }
  const { verdict, enforcement } = result.data;
  const failed =
    policy.kind === "legacy"
      ? policy.policy === "regression"
        ? verdict === "red"
        : policy.policy === "drift" && verdict !== "green"
      : violatesEnforcement({ enforcement }, policy.categories);
  return {
    code: failed ? 1 : 0,
    verdict,
    message: `verdict: ${verdict} (fail-on: ${rawPolicy.trim()}) — ${failed ? "check failed; see the full report" : "check passed"}.`,
  };
}
