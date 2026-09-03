import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { resolveDemoModel } from "../../lib/demo-model";

/**
 * Declared subagent. In deterministic test mode it uses its own scripted
 * mock model — a fixed one-line summary, so parent delegation is fully
 * reproducible. With gateway credentials (or an explicit DIFF0_DEMO_MODEL
 * model id) it runs the same real model as the root analyst, keeping keyed
 * runs real end to end — see agent/lib/demo-model.ts for the mode rules.
 */
const demoModel = resolveDemoModel(() => mockModel("Revenue summary: TOTAL_REVENUE=42."));

export default defineAgent({
  description: "Formats a one-line executive summary when the analyst explicitly delegates one.",
  // Mock model ids have no AI Gateway catalog entry; pin the window explicitly
  // in mock mode only (real gateway ids resolve theirs from the catalog).
  ...(demoModel.isMock ? { modelContextWindowTokens: 200_000 } : {}),
  model: demoModel.model,
});
