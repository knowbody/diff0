/**
 * Shared, render-target-agnostic formatting helpers. Pure string functions —
 * no report logic here (that lives in src/analyze/delta.ts).
 */
import type { ComparisonMeta, MetricStats } from "../analyze/types.js";

/**
 * One consistent precision rule everywhere costs render:
 * below $1 -> always 4 decimals ("$0.0300", "$0.0414"), so per-session costs
 * in the same table never mix precisions; $1 and up -> 2 decimals ("$12.00").
 * Some tiny positive values round *up* to "$0.0001" at four decimals rather
 * than to zero, so any finite value strictly between 0 and 0.0001 renders as
 * the literal "<$0.0001" instead of a misleading "$0.0000".
 */
export function formatUsd(value: number): string {
  if (Number.isFinite(value) && value > 0 && value < 0.0001) return "<$0.0001";
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
}

/** "+38%", "-12%", "+0%" — explicit sign, rounded to whole percent. */
export function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

/** "850ms" below one second, otherwise "12.3s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Thousands-separated integer: 12345 -> "12,345". */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/** "3/3", or an em dash when the eval never ran on that ref. */
export function passCell(passed: number, total: number): string {
  return total === 0 ? "—" : `${passed}/${total}`;
}

/** "3 runs per ref" (singular-aware) or "3 base runs / 2 head runs" when Ns differ. */
export function runsPhrase(meta: ComparisonMeta): string {
  const b = meta.base.runs;
  const h = meta.head.runs;
  const noun = (n: number) => (n === 1 ? "run" : "runs");
  return b === h ? `${b} ${noun(b)} per ref` : `${b} base ${noun(b)} / ${h} head ${noun(h)}`;
}

/** Median plus "(min–max)" range when the runs actually varied. */
export function medianWithRange(stats: MetricStats, fmt: (v: number) => string): string {
  const base = fmt(stats.median);
  if (stats.min === stats.max) return base;
  return `${base} (${fmt(stats.min)}–${fmt(stats.max)})`;
}
