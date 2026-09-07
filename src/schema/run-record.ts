import { z } from "zod";
import type { RunRecord } from "../types.js";

const nonNegative = z.number().finite().nonnegative();
const fingerprint = z.object({ hash: z.string(), length: nonNegative.optional() });
const scopedName = { name: z.string(), evalName: z.string().optional() };

/** Validate consumed fields, accepting unrelated host/cache additions. */
export const runRecordSchema = z.object({
  ref: z.string(),
  commitSha: z.string(),
  runIndex: z.number().int().nonnegative(),
  evalResults: z.array(
    z
      .object({
        name: z.string(),
        passed: z.boolean(),
        checks: z.array(
          z.object({
            name: z.string(),
            passed: z.boolean(),
            score: z.number().finite().min(0).max(1).optional(),
          }),
        ),
        durationMs: nonNegative.optional(),
        finalOutput: fingerprint.optional(),
        finalOutputAbsent: z.boolean().optional(),
      })
      .refine(
        (result) => !(result.finalOutputAbsent === true && result.finalOutput !== undefined),
        "Absent output cannot have a fingerprint",
      ),
  ),
  toolCalls: z.array(
    z.object({ ...scopedName, order: z.number().int().nonnegative(), inputsHash: z.string() }),
  ),
  skillLoads: z.array(z.object(scopedName)),
  skillsLoaded: z.array(z.string()),
  subagentCalls: z.array(z.object({ ...scopedName, order: z.number().int().nonnegative() })),
  finalOutput: fingerprint.optional(),
  tokens: z.object({
    input: nonNegative,
    output: nonNegative,
    cacheRead: nonNegative,
    cacheWrite: nonNegative,
  }),
  costUsd: nonNegative.nullable(),
  costSource: z.enum(["gateway", "priced-tokens", "unavailable"]).optional(),
  durationMs: nonNegative,
  sandboxBackend: z.enum(["docker", "microsandbox", "just-bash", "unknown"]),
  model: z.string(),
  pricingModel: z.string().nullable(),
  eveVersion: z.string(),
  dataSources: z.object({ evalJson: z.boolean(), spans: z.boolean(), logs: z.boolean() }),
  startedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp"),
});

/** Retain optional-field absence and extension fields after validating the consumed structure. */
export function isRunRecord(value: unknown): value is RunRecord {
  return runRecordSchema.safeParse(value).success;
}
