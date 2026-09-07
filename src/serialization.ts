/** JSON-compatible object entries in lexical order, omitting undefined object properties. */
function sortedEntries(value: object): Array<[string, unknown]> {
  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Fingerprint compatibility contract: lexical keys (including numeric-looking keys),
 * undefined array values become null, sparse array holes remain empty slots, and
 * objects are traversed without invoking toJSON. Keep these legacy hash semantics.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object")
    return `{${sortedEntries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Presentation projection: JSON.stringify retains standard numeric-key ordering and indentation. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      sortedEntries(value).map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}
