/**
 * JSON renderer — the machine artifact. Keys are recursively sorted so two
 * renders of the same report are byte-identical (stable for diffing, hashing,
 * and CI artifact comparison). schemaVersion gates future shape changes.
 */
import type { DeltaReport } from "../analyze/types.js";

export const JSON_SCHEMA_VERSION = 4;

function opaqueFingerprintLabels(report: DeltaReport): DeltaReport {
  const copy = structuredClone(report);
  const relabel = (delta: {
    baseHashes: string[];
    headHashes: string[];
    baseFrequencies: Array<{ hash: string; runs: number }>;
    headFrequencies: Array<{ hash: string; runs: number }>;
  }) => {
    const baseCounts = new Map(delta.baseFrequencies.map((item) => [item.hash, item.runs]));
    const headCounts = new Map(delta.headFrequencies.map((item) => [item.hash, item.runs]));
    const hashes = new Set([...delta.baseHashes, ...delta.headHashes]);
    const vectors = [
      ...new Set(
        [...hashes].map((hash) => `${baseCounts.get(hash) ?? 0}:${headCounts.get(hash) ?? 0}`),
      ),
    ].sort((a, b) => {
      const [aBase, aHead] = a.split(":").map(Number);
      const [bBase, bHead] = b.split(":").map(Number);
      return (bBase as number) - (aBase as number) || (bHead as number) - (aHead as number);
    });
    const vectorLabel = new Map(vectors.map((vector, index) => [vector, `fp-${index + 1}`]));
    const label = (hash: string) =>
      vectorLabel.get(`${baseCounts.get(hash) ?? 0}:${headCounts.get(hash) ?? 0}`) as string;
    const relabelFrequencies = (items: Array<{ hash: string; runs: number }>) =>
      items
        .map((item) => ({ ...item, hash: label(item.hash) }))
        .sort((a, b) => a.hash.localeCompare(b.hash) || a.runs - b.runs);
    // Equal-frequency identities share a label so lexical hash order cannot
    // reveal dictionary candidates. Duplicate labels/entries intentionally
    // preserve the number of distinct underlying fingerprints.
    delta.baseHashes = delta.baseHashes.map(label).sort();
    delta.headHashes = delta.headHashes.map(label).sort();
    delta.baseFrequencies = relabelFrequencies(delta.baseFrequencies);
    delta.headFrequencies = relabelFrequencies(delta.headFrequencies);
  };
  for (const input of copy.drift.toolInputs) relabel(input);
  for (const output of copy.drift.finalOutputs) relabel(output);
  return copy;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortKeysDeep(entryValue);
    }
    return sorted;
  }
  return value;
}

export type PublicReport = DeltaReport & { schemaVersion: typeof JSON_SCHEMA_VERSION };

/** Copy a report for publication, replacing reusable hashes with opaque labels. */
export function toPublicReport(report: DeltaReport): PublicReport {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    ...opaqueFingerprintLabels(report),
  };
}

export function renderJson(report: DeltaReport): string {
  const payload = sortKeysDeep(toPublicReport(report));
  return `${JSON.stringify(payload, null, 2)}\n`;
}
