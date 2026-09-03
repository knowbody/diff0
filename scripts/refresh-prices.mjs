#!/usr/bin/env node
// Regenerates prices.json from Vercel AI Gateway's public model list (no auth).
// Prices are USD per single token. diff0 uses this table only as a fallback
// when no cost attribution is present in captured traces.
import { writeFileSync } from "node:fs";

const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!res.ok) {
  console.error(`Failed to fetch model list: HTTP ${res.status}`);
  process.exit(1);
}
const { data = [] } = await res.json();
const models = {};
for (const m of data) {
  const p = m.pricing;
  if (!p || p.input == null || p.output == null) continue;
  models[m.id] = {
    inputPerToken: Number(p.input),
    outputPerToken: Number(p.output),
    ...(p.input_cache_read != null ? { cacheReadPerToken: Number(p.input_cache_read) } : {}),
    ...(p.input_cache_write != null ? { cacheWritePerToken: Number(p.input_cache_write) } : {}),
  };
}
const out = {
  "//":
    "USD per single token (multiply by 1e6 for per-million display). User-editable: diff0 falls back to this table when no cost data is present in traces. Regenerate with: pnpm run refresh-prices",
  source: "https://ai-gateway.vercel.sh/v1/models",
  fetchedAt: new Date().toISOString(),
  models,
};
writeFileSync(new URL("../prices.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`prices.json refreshed: ${Object.keys(models).length} models`);
