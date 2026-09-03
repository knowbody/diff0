/**
 * Cost fallback via the bundled prices.json (USD per token, generated from
 * the public AI Gateway model list — see scripts/refresh-prices.mjs).
 *
 * Honest-framing rules encoded here:
 * - Gateway-reported cost always wins over table pricing for a record.
 * - A record whose model has no table entry keeps costUsd null — a missing
 *   cost is NEVER invented as $0.
 * - The comparison-level label means: "gateway" = every record had gateway
 *   cost; "priced-tokens" = every record has a cost but at least one came
 *   from the table; "unavailable" = at least one record has no cost at all.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CostSource } from "../analyze/types.js";
import type { RunRecord } from "../types.js";
import { findFileUpward } from "./find-up.js";

export interface ModelPrice {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken?: number;
  cacheWritePerToken?: number;
}

interface PricesTable {
  models: Record<string, ModelPrice>;
}

export interface ApplyPricingOptions {
  /** Override the prices.json path (tests). Default: walk up from this module. */
  pricesPath?: string;
}

export interface ApplyPricingResult {
  /** Same order as the input; records are copies, inputs are never mutated. */
  records: RunRecord[];
  costSource: CostSource;
}

/** Locate the package-root prices.json from src/ and dist/ alike. */
function defaultPricesPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  return findFileUpward(here, "prices.json");
}

function loadPrices(pricesPath: string | undefined): Record<string, ModelPrice> {
  const path = pricesPath ?? defaultPricesPath();
  if (path === null) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PricesTable>;
    if (parsed.models === undefined || typeof parsed.models !== "object") return {};
    return parsed.models;
  } catch {
    // Unreadable/corrupt table -> no fallback pricing; records stay unpriced.
    return {};
  }
}

export function applyPricing(
  records: RunRecord[],
  opts: ApplyPricingOptions = {},
): ApplyPricingResult {
  if (records.length === 0) {
    return { records: [], costSource: "unavailable" };
  }

  if (records.every((r) => r.costUsd !== null)) {
    return { records, costSource: "gateway" };
  }

  const models = loadPrices(opts.pricesPath);
  let anyUnpriced = false;

  const priced = records.map((record): RunRecord => {
    if (record.costUsd !== null) return record; // gateway cost wins per record
    const price = record.pricingModel === null ? undefined : models[record.pricingModel];
    if (price === undefined) {
      anyUnpriced = true;
      return record;
    }
    if (
      (record.tokens.cacheRead > 0 && price.cacheReadPerToken === undefined) ||
      (record.tokens.cacheWrite > 0 && price.cacheWritePerToken === undefined)
    ) {
      // Never silently price cached tokens as ordinary input. Providers use materially different
      // read/write rates, and the gateway catalog does not always publish both.
      anyUnpriced = true;
      return record;
    }
    return {
      ...record,
      costUsd:
        record.tokens.input * price.inputPerToken +
        record.tokens.output * price.outputPerToken +
        record.tokens.cacheRead * (price.cacheReadPerToken ?? 0) +
        record.tokens.cacheWrite * (price.cacheWritePerToken ?? 0),
    };
  });

  return { records: priced, costSource: anyUnpriced ? "unavailable" : "priced-tokens" };
}
