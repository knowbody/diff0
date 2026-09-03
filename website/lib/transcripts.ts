import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Span } from "@/components/TerminalPanel";

const contentDir = join(process.cwd(), "content");

export function readContent(name: string): string {
  return readFileSync(join(contentDir, name), "utf8");
}

function splitLines(text: string): string[] {
  return text.replace(/\n$/, "").split("\n");
}

/** git diff output -> colored spans (red deletions, green additions, dim chrome). */
export function diffToSpans(text: string): Span[][] {
  return splitLines(text).map((line): Span[] => {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      return [{ text: line, cls: "dim" }];
    }
    // Deletion rows carry the story in beat 1 (the removed reporter
    // hand-off). GitHub-style: a calm red-tinted row with normal-color
    // text; only the leading "-" diff marker is red. One emphasis, not three.
    if (line.startsWith("-"))
      return [
        { text: "-", cls: "red delrow" },
        { text: line.slice(1), cls: "delrow" },
      ];
    if (line.startsWith("+")) return [{ text: line, cls: "green" }];
    return [{ text: line, cls: null }];
  });
}

/** eve eval stdout -> colored spans (green checks, red crosses, dim chrome). */
export function eveToSpans(text: string): Span[][] {
  return splitLines(text).map((line): Span[] => {
    const t = line.trimStart();
    if (t.startsWith("✓")) {
      const i = line.indexOf("✓");
      return [
        { text: line.slice(0, i + 1), cls: "green" },
        { text: line.slice(i + 1), cls: null },
      ];
    }
    if (t.startsWith("✗")) {
      const i = line.indexOf("✗");
      return [
        { text: line.slice(0, i + 1), cls: "red" },
        { text: line.slice(i + 1), cls: null },
      ];
    }
    if (line.startsWith("Results:")) return [{ text: line, cls: "bold" }];
    if (
      line.startsWith("EVALS") ||
      line.startsWith("target ") ||
      line.startsWith("Gates:") ||
      line.startsWith("Completed")
    ) {
      return [{ text: line, cls: "dim" }];
    }
    return [{ text: line, cls: null }];
  });
}

export function beat3Spans(): Span[][] {
  return JSON.parse(readContent("beat3.spans.json")) as Span[][];
}
