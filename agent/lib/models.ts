// One place to change every station model. IDs are Vercel AI Gateway strings.
// The reviewer intentionally uses a different provider family than the implementer.
export const MODELS = {
  analyst: "openai/gpt-5.6-terra-fast",
  classifier: "openai/gpt-5.6-terra-fast",
  implementer: "anthropic/claude-fable-5",
  orchestrator: "openai/gpt-5.6-terra-fast",
  researcher: "openai/gpt-5.6-terra-fast",
  reviewer: "openai/gpt-5.6-terra-fast",
} as const;

export type FactoryAgent = keyof typeof MODELS;
