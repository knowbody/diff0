import { ENFORCEMENT_CATEGORIES } from "./analyze/constants.js";
import type { EnforcementCategory } from "./analyze/types.js";
import { ConfigurationError } from "./errors.js";
import { normalizeValidityPattern } from "./harness/gitdiff.js";
import { normalizeAppDirectory } from "./harness/paths.js";

export type LegacyFailOn = "regression" | "drift" | "never";
export type FailOnPolicy =
  | { kind: "legacy"; policy: LegacyFailOn }
  | { kind: "granular"; categories: EnforcementCategory[] };
const LEGACY_FAIL_ON: readonly string[] = ["regression", "drift", "never"];
export function parseFailOn(value: string): FailOnPolicy {
  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    throw new ConfigurationError("--fail-on must not contain empty policy names");
  }
  if (tokens.length === 1 && tokens[0] !== undefined && LEGACY_FAIL_ON.includes(tokens[0])) {
    return { kind: "legacy", policy: tokens[0] as LegacyFailOn };
  }
  if (tokens.some((token) => LEGACY_FAIL_ON.includes(token))) {
    throw new ConfigurationError("--fail-on cannot mix legacy and granular policies");
  }
  const unknown = tokens.filter(
    (token) => !ENFORCEMENT_CATEGORIES.includes(token as EnforcementCategory),
  );
  if (unknown.length > 0)
    throw new ConfigurationError(`unknown --fail-on policy: ${unknown.join(", ")}`);
  return { kind: "granular", categories: [...new Set(tokens as EnforcementCategory[])] };
}
export function positiveInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ConfigurationError(
      `${label} must be a positive integer within the safe range (got ${value})`,
    );
  return value;
}
export function positiveUsd(label: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new ConfigurationError(`${label} must be a positive USD amount (got ${value})`);
  return value;
}
export function nonNegativePercentage(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new ConfigurationError(
      `${label} must be a finite non-negative percentage (got ${value})`,
    );
  return value;
}
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function parsePositiveInt(label: string) {
  return (text: string): number =>
    positiveInteger(label, /^\d+$/.test(text.trim()) ? Number(text) : NaN);
}
export function parseUsd(label: string) {
  return (text: string): number =>
    positiveUsd(label, DECIMAL.test(text.trim()) ? Number(text) : NaN);
}
export function parseNonNegativePercentage(label: string) {
  return (text: string): number =>
    nonNegativePercentage(label, DECIMAL.test(text.trim()) ? Number(text) : NaN);
}

interface CollectionOptions {
  appDir: string;
  runs: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  maxSpendUsd?: number;
  installMode?: string;
  validityPatterns?: string[];
  evalFilter: string[];
}
/** Validate caller-controlled values before ref resolution, installation or paid work. */
export function validateCollectionOptions(options: CollectionOptions): void {
  positiveInteger("runs", options.runs);
  if (options.runs > Number.MAX_SAFE_INTEGER / 2)
    throw new ConfigurationError("runs is too large for a two-ref comparison");
  if (options.timeoutMs !== undefined) {
    positiveInteger("timeoutMs", options.timeoutMs);
    if (options.timeoutMs > 2_147_483_647)
      throw new ConfigurationError(
        "timeoutMs exceeds Node's maximum timer duration (2147483647ms)",
      );
  }
  if (options.maxConcurrency !== undefined)
    positiveInteger("maxConcurrency", options.maxConcurrency);
  if (options.maxSpendUsd !== undefined) positiveUsd("maxSpendUsd", options.maxSpendUsd);
  if (
    options.installMode !== undefined &&
    !["scripts-off", "scripts-on"].includes(options.installMode)
  )
    throw new ConfigurationError("installMode must be scripts-off or scripts-on");
  normalizeAppDirectory(options.appDir);
  for (const pattern of options.validityPatterns ?? []) normalizeValidityPattern(pattern);
  if (
    !Array.isArray(options.evalFilter) ||
    options.evalFilter.some((filter) => typeof filter !== "string" || filter.trim().length === 0)
  )
    throw new ConfigurationError("evalFilter must contain non-empty strings");
}
