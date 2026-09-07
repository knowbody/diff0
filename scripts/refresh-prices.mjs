#!/usr/bin/env node
// Regenerates prices.json from Vercel AI Gateway's public model list (no auth).
// Prices are USD per single token. diff0 uses this table only as a fallback
// when no cost attribution is present in captured traces.
import { renameSync, writeFileSync } from "node:fs";
import { parseGatewayPrices } from "./lib/prices.mjs";

const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!res.ok) {
  console.error(`Failed to fetch model list: HTTP ${res.status}`);
  process.exit(1);
}
const models = parseGatewayPrices(await res.json());
const out = {
  "//": "USD per single token (multiply by 1e6 for per-million display). User-editable: diff0 falls back to this table when no cost data is present in traces. Regenerate with: pnpm run refresh-prices",
  source: "https://ai-gateway.vercel.sh/v1/models",
  fetchedAt: new Date().toISOString(),
  models,
};
const target = new URL("../prices.json", import.meta.url);
const temporary = new URL(`../prices.json.${process.pid}.tmp`, import.meta.url);
writeFileSync(temporary, `${JSON.stringify(out, null, 2)}\n`);
renameSync(temporary, target);
console.log(`prices.json refreshed: ${Object.keys(models).length} models`);
