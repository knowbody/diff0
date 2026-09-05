// One place to change every station model. IDs are Vercel AI Gateway strings.
// Standard pricing tiers only; reserve larger models for an explicit future decision.
// The reviewer intentionally uses a different provider family than the implementer.
export const MODELS = {
  analyst: "openai/gpt-5.4-mini",
  classifier: "openai/gpt-5.6-luna",
  implementer: "anthropic/claude-sonnet-5",
  orchestrator: "openai/gpt-5.4-mini",
  researcher: "openai/gpt-5.4-mini",
  reviewer: "openai/gpt-5.6-terra",
} as const;

export type FactoryAgent = keyof typeof MODELS;
