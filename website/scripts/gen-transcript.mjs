/**
 * Generation-time only. Renders the current-schema reinterpretation of the
 * committed showcase evidence. Raw run/cost/subagent facts are historical;
 * unsupported suite-global trajectory data was deliberately omitted because
 * current diff0 scopes those signals per eval.
 * through the CLI's own terminal renderer, producing:
 *
 *   content/beat3.txt         — plain render (color off), verbatim
 *   content/beat3.spans.json  — array of lines, each an array of {text, cls}
 *                               spans derived from the ANSI (picocolors) codes
 *
 * The OUTPUT files are committed; the website build never imports the CLI.
 * Re-run manually after a renderer change: `node scripts/gen-transcript.mjs`
 * (requires `pnpm build` at the repo root so ../dist exists).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "content");

const { renderTerminal } = await import(
  join(here, "..", "..", "dist", "report", "terminal.js")
);

const report = JSON.parse(
  readFileSync(join(contentDir, "drift-report.json"), "utf8"),
);

// 1. Plain text render (no ANSI).
const plain = renderTerminal(report, { color: false });
writeFileSync(join(contentDir, "beat3.txt"), plain);

// 2. Colored render -> semantic spans.
// picocolors emits standard SGR codes. Map them to CSS classes:
//   1  bold          -> "bold" flag folded into cls
//   2  dim           -> dim
//   31 red           -> red
//   32 green         -> green
//   33 yellow        -> yellow
//   22 reset bold/dim, 39 reset fg, 0 reset all
const colored = renderTerminal(report, { color: true });

function ansiToSpans(line) {
  const spans = [];
  let fg = null; // "red" | "green" | "yellow" | null
  let bold = false;
  let dim = false;
  let buf = "";
  const flush = () => {
    if (buf === "") return;
    const parts = [];
    if (fg) parts.push(fg);
    if (bold) parts.push("bold");
    if (dim) parts.push("dim");
    spans.push({ text: buf, cls: parts.join(" ") || null });
    buf = "";
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    buf += line.slice(last, m.index);
    flush();
    for (const code of (m[1] || "0").split(";")) {
      switch (code) {
        case "0":
          fg = null;
          bold = false;
          dim = false;
          break;
        case "1":
          bold = true;
          break;
        case "2":
          dim = true;
          break;
        case "22":
          bold = false;
          dim = false;
          break;
        case "31":
          fg = "red";
          break;
        case "32":
          fg = "green";
          break;
        case "33":
          fg = "yellow";
          break;
        case "39":
          fg = null;
          break;
        default:
          break; // unknown code: ignore, keep text
      }
    }
    last = m.index + m[0].length;
  }
  buf += line.slice(last);
  flush();
  return spans;
}

const lines = colored.replace(/\n$/, "").split("\n").map(ansiToSpans);

// The replay emphasizes exactly three money lines. Row markers are presentation-only and do not
// alter the text-reassembly check below.
for (const spans of lines) {
  const line = spans.map((span) => span.text).join("");
  if (
    line.startsWith("diff0 ") ||
    (line.includes("reporter") && line.includes("used in")) ||
    line.trimStart().startsWith("cost/session")
  ) {
    const first = spans[0];
    if (first) first.cls = [first.cls, "money"].filter(Boolean).join(" ");
  }
}
writeFileSync(
  join(contentDir, "beat3.spans.json"),
  `${JSON.stringify(lines, null, 1)}\n`,
);

// Sanity: spans text must reassemble to the plain render exactly.
const reassembled = `${lines
  .map((l) => l.map((s) => s.text).join(""))
  .join("\n")}\n`;
if (reassembled !== plain) {
  console.error("MISMATCH: span text does not reassemble to the plain render");
  process.exit(1);
}
console.log(
  `beat3.txt: ${plain.split("\n").length - 1} lines; beat3.spans.json OK (reassembly verified)`,
);
