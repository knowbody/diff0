import type { CostSource } from "./analyze/types.js";
import type { RunRecord } from "./types.js";

type CostRecord = Pick<RunRecord, "costUsd" | "costSource">;

/** Legacy mock zeros lack evidence. Explicitly sourced zero is a measured, usable cost. */
export function availableCost(record: CostRecord): number | null {
  const amount = record.costUsd;
  if (
    amount === null ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    record.costSource === "unavailable"
  )
    return null;
  if (amount === 0 && record.costSource === undefined) return null;
  return amount;
}

/** A partial sample cannot support a complete total, estimate, or median comparison. */
export function usableCosts(records: readonly CostRecord[]): number[] | null {
  if (records.length === 0) return null;
  const costs = records.map(availableCost);
  return costs.every((cost): cost is number => cost !== null) ? costs : null;
}

/** Mixed gateway/table records retain the table-pricing qualification. */
export function summarizeCostSource(records: readonly CostRecord[]): CostSource {
  if (usableCosts(records) === null) return "unavailable";
  return records.some((record) => record.costSource === "priced-tokens")
    ? "priced-tokens"
    : "gateway";
}
