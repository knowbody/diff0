/**
 * Extract the last complete JSON document from a text stream.
 *
 * `eve eval --json` writes the run summary to stdout, but stdout can also
 * carry host noise (e.g. `eve info --json` prints a banner line before its
 * JSON; the embedded Nitro host could in principle log too). This parser is
 * defensive: it finds every candidate document start — a `{` or `[` at the
 * beginning of a line — scans to the balanced end (string-aware, so braces
 * inside JSON strings do not confuse it), and returns the parse of the last
 * candidate that is valid JSON.
 *
 * Assumption: real documents start at column 0. This holds for everything
 * eve emits (`JSON.stringify(value, null, 2)` puts only the outermost
 * bracket at column 0) and for compact single-line documents. Indented
 * brackets inside a pretty-printed document are never candidates, so inner
 * objects cannot be mistaken for the document.
 */
export function lastJsonDocument(text: string): unknown {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if ((ch === "{" || ch === "[") && (i === 0 || text.charAt(i - 1) === "\n")) {
      starts.push(i);
    }
  }
  for (let s = starts.length - 1; s >= 0; s--) {
    const start = starts[s];
    if (start === undefined) {
      continue;
    }
    const end = scanBalancedEnd(text, start);
    if (end === -1) {
      continue;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Candidate was balanced but not valid JSON (noise); keep looking.
    }
  }
  throw new Error(
    `No JSON document found in output (${text.length} chars). ` +
      "Expected a { or [ at the start of a line beginning a valid JSON document.",
  );
}

/**
 * Return the index of the character that closes the bracket opened at
 * `start`, honoring JSON string and escape rules, or -1 if the text ends
 * before the document balances.
 */
function scanBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
