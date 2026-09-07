import { build } from "esbuild";

await build({
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  bundle: true,
  entryPoints: { cli: "scripts/action-entry.ts", policy: "scripts/action-policy-entry.ts" },
  define: { DIFF0_ACTION_BUNDLE: "true" },
  format: "esm",
  legalComments: "eof",
  minify: true,
  outdir: "action/dist",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node20",
});
