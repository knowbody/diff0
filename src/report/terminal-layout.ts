import stringWidth from "string-width";

export const MAX_LINE_WIDTH = 96;
export { stringWidth as displayWidth };

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function padColumns(value: string, columns: number): string {
  return value + " ".repeat(Math.max(0, columns - stringWidth(value)));
}

/** Split only between grapheme clusters, never inside emoji or combining sequences. */
function takeColumns(value: string, columns: number): [string, string] {
  let end = 0;
  let width = 0;
  for (const part of graphemes.segment(value)) {
    const nextWidth = stringWidth(part.segment);
    if (width + nextWidth > columns) break;
    width += nextWidth;
    end = part.index + part.segment.length;
  }
  return [value.slice(0, end), value.slice(end)];
}

/** Greedy word wrapping; exceptionally long tokens split at grapheme boundaries. */
export function wrapTokens(tokens: string[], firstIndent: string, contIndent: string): string[] {
  // Indents are internal layout inputs. Reject impossible budgets rather than looping forever.
  if (
    stringWidth(firstIndent) > MAX_LINE_WIDTH - 2 ||
    stringWidth(contIndent) > MAX_LINE_WIDTH - 2
  ) {
    throw new Error("Terminal wrap indent must leave at least two display columns.");
  }
  const lines: string[] = [];
  let current = firstIndent;
  let hasToken = false;
  for (const token of tokens) {
    let remaining = token;
    if (hasToken && stringWidth(`${current} ${remaining}`) > MAX_LINE_WIDTH) {
      lines.push(current);
      current = contIndent;
      hasToken = false;
    }
    let separator = hasToken ? " " : "";
    while (stringWidth(remaining) > MAX_LINE_WIDTH - stringWidth(current + separator)) {
      const [part, rest] = takeColumns(
        remaining,
        MAX_LINE_WIDTH - stringWidth(current + separator),
      );
      lines.push(current + separator + part);
      remaining = rest;
      current = contIndent;
      separator = "";
    }
    current += separator + remaining;
    hasToken = remaining.length > 0;
  }
  if (hasToken || lines.length === 0) lines.push(current);
  return lines;
}

export function wrapText(text: string, firstIndent: string, contIndent: string): string[] {
  return wrapTokens(text.split(" "), firstIndent, contIndent);
}

/** Prefer segment boundaries; fall back to word/grapheme wrapping for oversized segments. */
export function packSegments(segments: string[], sep: string, contIndent: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (const segment of segments) {
    if (current === "") current = segment;
    else if (stringWidth(`${current}${sep}${segment}`) > MAX_LINE_WIDTH) {
      lines.push(...wrapText(current, "", contIndent));
      current = `${contIndent}${segment}`;
    } else current += sep + segment;
  }
  if (current !== "") lines.push(...wrapText(current, "", contIndent));
  return lines;
}
