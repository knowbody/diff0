import { build } from "esbuild";

await build({
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  bundle: true,
  entryPoints: ["scripts/action-entry.ts"],
  define: { DIFF0_ACTION_BUNDLE: "true" },
  format: "esm",
  legalComments: "eof",
  minify: true,
  outfile: "action/dist/cli.mjs",
  platform: "node",
  target: "node20",
});
