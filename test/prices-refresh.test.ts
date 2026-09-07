import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Exercise the Node-compatible pure script module without fetching or writing the price table. */
function parseCatalog(payload: unknown): unknown {
  const script = `
    import { readFileSync } from 'node:fs';
    import { parseGatewayPrices } from './scripts/lib/prices.mjs';
    try { console.log(JSON.stringify({ models: parseGatewayPrices(JSON.parse(readFileSync(0, 'utf8'))) })); }
    catch { console.log(JSON.stringify({ invalid: true })); }
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      input: JSON.stringify(payload),
      encoding: "utf8",
    }),
  );
}

describe("price catalog refresh validation", () => {
  it.each(["", "   ", "oops", "Infinity", -1, null])(
    "rejects malformed or incomplete input rate %j",
    (input) => {
      expect(parseCatalog({ data: [{ id: "m", pricing: { input, output: "0.002" } }] })).toEqual({
        invalid: true,
      });
    },
  );
  it("rejects malformed and empty catalog shapes", () => {
    expect(parseCatalog({ data: null })).toEqual({ invalid: true });
    expect(parseCatalog({ data: [] })).toEqual({ invalid: true });
  });
  it("accepts finite zero and decimal rates and carries optional cache rates", () => {
    expect(
      parseCatalog({
        data: [{ id: "m", pricing: { input: " 0 ", output: "2e-6", input_cache_read: 0.000001 } }],
      }),
    ).toEqual({
      models: { m: { inputPerToken: 0, outputPerToken: 0.000002, cacheReadPerToken: 0.000001 } },
    });
  });
});
