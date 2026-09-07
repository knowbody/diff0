import { z } from "zod";

/** Parse the consumed catalog fields before any committed table is replaced. */
export function parseGatewayPrices(payload) {
  const gatewayRate = z
    .union([z.number(), z.string().trim().min(1)])
    .transform(Number)
    .pipe(z.number().finite().nonnegative());
  const { data } = z
    .object({
      data: z.array(
        z.object({
          id: z.string().trim().min(1),
          pricing: z
            .object({
              input: gatewayRate.nullish(),
              output: gatewayRate.nullish(),
              input_cache_read: gatewayRate.nullish(),
              input_cache_write: gatewayRate.nullish(),
            })
            .nullish(),
        }),
      ),
    })
    .parse(payload);
  const entries = [];
  for (const m of data) {
    const p = m.pricing;
    if (!p || p.input == null || p.output == null) continue;
    entries.push([
      m.id,
      {
        inputPerToken: p.input,
        outputPerToken: p.output,
        ...(p.input_cache_read != null ? { cacheReadPerToken: p.input_cache_read } : {}),
        ...(p.input_cache_write != null ? { cacheWritePerToken: p.input_cache_write } : {}),
      },
    ]);
  }
  const models = Object.fromEntries(entries);
  if (Object.keys(models).length === 0)
    throw new Error("Refusing to replace prices.json with an empty catalog.");
  return models;
}
