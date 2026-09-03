import type { LanguageModel } from "ai";

/**
 * Demo model selection — the switch behind diff0's credential-free CI mode.
 *
 * Three modes, resolved in priority order:
 *
 * 1. `DIFF0_DEMO_MODEL=mock` — force the deterministic mock model, even when
 *    gateway credentials are present. diff0's own integration tests pin this
 *    so they stay hermetic (zero credentials, zero spend) on keyed machines.
 * 2. `DIFF0_DEMO_MODEL=<any other non-empty value>` — used verbatim as an
 *    AI Gateway model id (e.g. "anthropic/claude-sonnet-4.5"). Needs
 *    AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN at run time.
 * 3. Unset (auto) — the real default model when gateway credentials are
 *    detected in the environment; otherwise the mock. This makes real-model
 *    runs the default the moment a key exists, while CI and tests keep
 *    running credential-free with eve's scripted-LLM mock.
 *
 * Both the root analyst agent and the reporter subagent resolve through this
 * helper: a keyed run is real end to end, a credential-free run is
 * deterministic end to end.
 */

/** Default real model: cheap Haiku-class via the AI Gateway ($1/$5 per Mtok). */
export const DEMO_REAL_MODEL = "anthropic/claude-haiku-4.5";

export interface DemoModelSelection {
  /** Value for defineAgent's `model`: a gateway id string or a mock instance. */
  readonly model: string | LanguageModel;
  /** True when the deterministic mock is active (credential-free CI mode). */
  readonly isMock: boolean;
}

export function resolveDemoModel(mock: () => LanguageModel): DemoModelSelection {
  const override = process.env.DIFF0_DEMO_MODEL;
  if (override === "mock") {
    return { model: mock(), isMock: true };
  }
  if (override) {
    // Any other non-empty value is a gateway model id, passed through verbatim.
    return { model: override, isMock: false };
  }
  const hasGatewayCredentials =
    Boolean(process.env.AI_GATEWAY_API_KEY) || Boolean(process.env.VERCEL_OIDC_TOKEN);
  if (hasGatewayCredentials) {
    return { model: DEMO_REAL_MODEL, isMock: false };
  }
  return { model: mock(), isMock: true };
}
