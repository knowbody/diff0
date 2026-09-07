import { round } from "../numeric.js";

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const m = Math.min(k, n - k);
  let result = 0;
  for (let i = 1; i <= m; i += 1) result += Math.log(n - m + i) - Math.log(i);
  return result;
}

function hypergeometricProbability(
  x: number,
  rowOneTotal: number,
  rowTwoTotal: number,
  successes: number,
): number {
  return Math.exp(
    logChoose(successes, x) +
      logChoose(rowOneTotal + rowTwoTotal - successes, rowOneTotal - x) -
      logChoose(rowOneTotal + rowTwoTotal, rowOneTotal),
  );
}

/** One-sided Fisher exact p-value in the observed effect direction. */
export function fisherExactDirectional(
  basePassed: number,
  baseTotal: number,
  headPassed: number,
  headTotal: number,
): number {
  const successes = basePassed + headPassed;
  const min = Math.max(0, baseTotal - (baseTotal + headTotal - successes));
  const max = Math.min(baseTotal, successes);
  const baseRateHigher = basePassed / baseTotal > headPassed / headTotal;
  let p = 0;
  if (baseRateHigher) {
    for (let x = basePassed; x <= max; x += 1) {
      p += hypergeometricProbability(x, baseTotal, headTotal, successes);
    }
  } else {
    for (let x = min; x <= basePassed; x += 1) {
      p += hypergeometricProbability(x, baseTotal, headTotal, successes);
    }
  }
  return Math.min(1, p);
}

export function fisherExactTwoSided(
  baseCount: number,
  baseTotal: number,
  headCount: number,
  headTotal: number,
): number {
  const successes = baseCount + headCount;
  const min = Math.max(0, baseTotal - (baseTotal + headTotal - successes));
  const max = Math.min(baseTotal, successes);
  const observed = hypergeometricProbability(baseCount, baseTotal, headTotal, successes);
  let p = 0;
  for (let x = min; x <= max; x += 1) {
    const probability = hypergeometricProbability(x, baseTotal, headTotal, successes);
    if (probability <= observed + 1e-12) p += probability;
  }
  return Math.min(1, p);
}

export function formatP(value: number): string {
  return value < 0.0001 ? "<0.0001" : round(value, 4).toString();
}

export function twoProportionHint(
  basePassed: number,
  baseTotal: number,
  headPassed: number,
  headTotal: number,
): { zScore: number; note: string } | null {
  const pooled = (basePassed + headPassed) / (baseTotal + headTotal);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / baseTotal + 1 / headTotal));
  if (se === 0) return null;
  const z = (basePassed / baseTotal - headPassed / headTotal) / se;
  const zScore = round(z, 2);
  return {
    zScore,
    note:
      `two-proportion z = ${zScore} (${basePassed}/${baseTotal} base vs ${headPassed}/${headTotal} head) — ` +
      "a directional hint only, not statistical significance at this sample size",
  };
}

/** Holm step-down adjustment in original hypothesis order; decisions use unrounded values. */
export function holmAdjusted(pValues: number[]): number[] {
  const ranked = pValues
    .map((pValue, index) => ({ pValue, index }))
    .sort((a, b) => a.pValue - b.pValue || a.index - b.index);
  const adjusted = new Array<number>(pValues.length);
  let runningMaximum = 0;
  ranked.forEach((entry, rank) => {
    runningMaximum = Math.max(runningMaximum, (pValues.length - rank) * entry.pValue);
    adjusted[entry.index] = Math.min(1, runningMaximum);
  });
  return adjusted;
}
