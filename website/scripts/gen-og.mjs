/**
 * Generation-time only: renders public/og.png (1200x630) and
 * app/apple-icon.png (180x180). Outputs are committed; the website build
 * never runs this. Re-run manually: `node scripts/gen-og.mjs`.
 *
 * Fonts come straight from the installed `geist` package (TTFs).
 * The 🟡 is drawn as a yellow disc because satori has no emoji font here.
 * Public claims are derived from content/showcase.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fontDir = join(root, "node_modules", "geist", "dist", "fonts");
const showcase = JSON.parse(
  readFileSync(join(root, "content", "showcase.json"), "utf8"),
);
const reporter = showcase.subagent;

const mono = readFileSync(join(fontDir, "geist-mono", "GeistMono-Regular.ttf"));
const monoMedium = readFileSync(
  join(fontDir, "geist-mono", "GeistMono-Medium.ttf"),
);

const YELLOW = "#f5a623";
const BG = "#0a0a0a";
const FG = "#ededed";
const MUTED = "#a1a1a1";
const LINE = "#262626";

const el = (type, props = {}, ...children) => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
});

const og = el(
  "div",
  {
    style: {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: BG,
      padding: "56px 64px",
      fontFamily: "GeistMono",
      border: `2px solid ${LINE}`,
    },
  },
  el(
    "div",
    { style: { display: "flex", fontSize: "30px", color: FG, fontWeight: 500 } },
    "diff0",
  ),
  el(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "26px" } },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "22px",
        },
      },
      el("div", {
        style: {
          width: "34px",
          height: "34px",
          borderRadius: "17px",
          backgroundColor: YELLOW,
          display: "flex",
        },
      }),
      el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: "44px",
            color: YELLOW,
            fontWeight: 500,
          },
        },
        "real-model drift · no eval regression",
      ),
    ),
    el(
      "div",
      { style: { display: "flex", fontSize: "30px", color: MUTED } },
      `reporter: ${reporter.baseUsedRuns}/${reporter.baseTotalRuns} -> ${reporter.headUsedRuns}/${reporter.headTotalRuns} · output -41% · duration -46%`,
    ),
  ),
  el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          fontSize: "21px",
          color: MUTED,
          lineHeight: 1.6,
        },
      },
      el("div", { style: { display: "flex" } },
        "git diff tells you what changed in the code."),
      el(
        "div",
        { style: { display: "flex", color: FG } },
        "diff0 tells you what changed in the agent.",
      ),
    ),
    el(
      "div",
      { style: { display: "flex", fontSize: "21px", color: MUTED } },
      "diff0.io",
    ),
  ),
);

const svg = await satori(og, {
  width: 1200,
  height: 630,
  fonts: [
    { name: "GeistMono", data: mono, weight: 400, style: "normal" },
    { name: "GeistMono", data: monoMedium, weight: 500, style: "normal" },
  ],
});

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
}).render().asPng();
writeFileSync(join(root, "public", "og.png"), png);
console.log(`public/og.png written (${png.length} bytes)`);

const iconSvg = readFileSync(join(root, "app", "icon.svg"), "utf8");
const iconPng = new Resvg(iconSvg, {
  fitTo: { mode: "width", value: 180 },
}).render().asPng();
writeFileSync(join(root, "app", "apple-icon.png"), iconPng);
console.log(`app/apple-icon.png written (${iconPng.length} bytes)`);
