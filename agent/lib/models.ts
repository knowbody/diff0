// One place to change every station model. IDs are Vercel AI Gateway strings.
// Standard pricing tiers only; reserve larger models for an explicit future decision.
// Luna trial: Terra retains a separate reviewer context; provider diversity is relaxed.
export const MODELS = {
  analyst: "openai/gpt-5.4-mini",
  classifier: "openai/gpt-5.6-luna",
  implementer: "openai/gpt-5.6-luna",
  orchestrator: "openai/gpt-5.6-luna",
  researcher: "openai/gpt-5.4-mini",
  reviewer: "openai/gpt-5.6-terra",
} as const;

export type FactoryAgent = keyof typeof MODELS;

/** Extra reasoning is reserved for the implementation trial. */
export const STATION_REASONING = "xhigh" as const;
