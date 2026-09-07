import { z } from "zod";

const count = z.number().finite().nonnegative();
const usage = z.object({
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
  costUsd: count.optional(),
});
const event = z.object({
  type: z.string().optional(),
  data: z
    .object({
      modelId: z.string().optional(),
      stepIndex: count.optional(),
      turnId: z.string().optional(),
      usage: usage.optional(),
      message: z.unknown().optional(),
      result: z
        .object({
          kind: z.string().optional(),
          usage: usage.optional(),
          outcome: z.object({ usageDelta: usage.optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");
const timed = { startedAt: timestamp.optional(), completedAt: timestamp.optional() };
const chronological = (value: {
  startedAt?: string | undefined;
  completedAt?: string | undefined;
}) =>
  value.startedAt === undefined ||
  value.completedAt === undefined ||
  Date.parse(value.completedAt) >= Date.parse(value.startedAt);
const result = z
  .object({
    id: z.string().min(1),
    verdict: z.string().optional(),
    ...timed,
    assertions: z
      .array(
        z.object({
          name: z.string().optional(),
          score: z.number().min(0).max(1).optional(),
          severity: z.string().optional(),
          passed: z.boolean().optional(),
          message: z.string().optional(),
        }),
      )
      .optional(),
    result: z
      .object({
        output: z.unknown().optional(),
        finalMessage: z.unknown().optional(),
        derived: z
          .object({
            toolCalls: z
              .array(
                z.object({
                  name: z.string().optional(),
                  input: z.unknown().optional(),
                  status: z.string().optional(),
                  turnIndex: count.optional(),
                }),
              )
              .optional(),
            subagentCalls: z
              .array(z.object({ name: z.string().optional(), turnIndex: count.optional() }))
              .optional(),
          })
          .optional(),
        events: z.array(event).optional(),
        runtimeIdentity: z
          .object({ eveVersion: z.string().optional(), modelId: z.string().optional() })
          .optional(),
      })
      .optional(),
  })
  .refine(chronological, "completedAt precedes startedAt");
const summarySchema = z
  .object({ results: z.array(result), ...timed })
  .refine(chronological, "completedAt precedes startedAt");

/** Validate only consumed fields; unrelated upstream fields are tolerated and discarded. */
export function parseEveSummary(value: unknown): EveEvalRunSummary {
  return summarySchema.parse(value);
}
export function parseEveListing(value: unknown): Array<{ id: string }> {
  return z.array(z.object({ id: z.string().min(1) })).parse(value);
}
export function parseAgentInfo(value: unknown) {
  const parsed = z
    .object({
      model: z.string().nullable().optional(),
      skills: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      subagents: z.array(z.string()).optional(),
    })
    .parse(value);
  return {
    model: parsed.model ?? null,
    skills: parsed.skills ?? [],
    tools: parsed.tools ?? [],
    subagents: parsed.subagents ?? [],
  };
}

/** Inferred consumed-field types also support partial legacy fixtures in the pure mapper. */
export type EveJsonEvent = z.infer<typeof event>;
export type EveJsonEvalResult = Partial<z.infer<typeof result>>;
export type EveEvalRunSummary = Omit<Partial<z.infer<typeof summarySchema>>, "results"> & {
  results?: EveJsonEvalResult[] | undefined;
};
