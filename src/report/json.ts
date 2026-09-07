/**
 * JSON renderer — the machine artifact. Keys are recursively sorted so two
 * renders of the same report are byte-identical (stable for diffing, hashing,
 * and CI artifact comparison). schemaVersion gates future shape changes.
 */
import { sortKeysDeep } from "../serialization.js";
import { JSON_SCHEMA_VERSION } from "./schema.js";

export { JSON_SCHEMA_VERSION } from "./schema.js";

import type { DeltaReport, FinalOutputDelta, ToolInputDelta } from "../analyze/types.js";

function opaqueFingerprintLabels(report: DeltaReport): Omit<PublicReport, "schemaVersion"> {
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
  // Every fingerprint-bearing collection was relabeled above; this is the sole branding boundary.
  return copy as Omit<PublicReport, "schemaVersion">;
}

declare const publicFingerprint: unique symbol;
/** Public labels cannot be mistaken for reusable internal fingerprints when publishing. */
export type PublicFingerprint = string & { readonly [publicFingerprint]: true };
type PublicFingerprintDelta<T> = Omit<
  T,
  "baseHashes" | "headHashes" | "baseFrequencies" | "headFrequencies"
> & {
  baseHashes: PublicFingerprint[];
  headHashes: PublicFingerprint[];
  baseFrequencies: Array<{ hash: PublicFingerprint; runs: number }>;
  headFrequencies: Array<{ hash: PublicFingerprint; runs: number }>;
};
/** Explicit redacted projection; still structurally consumable by human renderers. */
export type PublicReport = Omit<DeltaReport, "drift"> & {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  drift: Omit<DeltaReport["drift"], "toolInputs" | "finalOutputs"> & {
    toolInputs: Array<PublicFingerprintDelta<ToolInputDelta>>;
    finalOutputs: Array<PublicFingerprintDelta<FinalOutputDelta>>;
  };
};

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
