import type { MetricDelta, MetricStats } from "./analyze/types.js";

/** Full-precision median; empty samples are a caller error. Inputs are not mutated. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median: empty input");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] as number;
  // Same-sign subtraction cannot overflow; opposite signs need separate halves.
  return Math.sign(lower) === Math.sign(upper)
    ? lower + (upper - lower) / 2
    : lower / 2 + upper / 2;
}

/** Empty samples have no statistics, rather than a fabricated zero. */
export function metricStats(values: readonly number[]): MetricStats | null {
  if (values.length === 0) return null;
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** Keep decision values at full precision; reporters own display rounding. */
export function metricDelta(baseValues: number[] | null, headValues: number[] | null): MetricDelta {
  const base = baseValues === null ? null : metricStats(baseValues);
  const head = headValues === null ? null : metricStats(headValues);
  return {
    base,
    head,
    deltaPct:
      base !== null && head !== null && base.median !== 0
        ? ((head.median - base.median) / base.median) * 100
        : null,
  };
}

export function sequencesEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Display/evidence precision only; never feed the result into a budget decision. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
