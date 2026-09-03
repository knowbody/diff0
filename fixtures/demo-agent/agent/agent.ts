import type { LanguageModel } from "ai";
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { resolveDemoModel } from "./lib/demo-model";

/**
 * Deterministic mock model, context-sensitive on the system prompt — the
 * credential-free CI mode of this fixture (see agent/lib/demo-model.ts for
 * when it is active vs a real gateway model).
 *
 * The mock follows the two process rules used by the public drift demo:
 * loading `revenue-definitions` and delegating the final summary. Removing
 * either rule from instructions.md therefore changes observable behavior
 * while the answer-focused evals still pass.
 *
 * Response sequence per turn:
 *   1. load_skill(revenue-definitions)  — only when instructed to
 *   2. run_sql(...)                     — always
 *   3. reporter subagent                — only when instructed to delegate
 *   4. final text containing TOTAL_REVENUE=42
 */
function buildMockModel(): LanguageModel {
  return mockModel({
    modelId: "mock-revenue-analyst",
    provider: "eve-mock",
    respond: (request) => {
      const systemText = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.text)
        .join("\n");
      // Key on the authored instruction sentence, not the bare skill name:
      // eve's framework-generated "Available skills" section names every
      // skill in the system prompt regardless of instructions.md, so the
      // skill name alone is always present.
      const mustLoadSkill = systemText.includes("MUST load the `revenue-definitions` skill");
      const mustDelegateSummary = systemText.includes(
        "delegate a one-line executive summary to the",
      );
      const skillLoaded = request.toolResults.some((result) => result.name === "load_skill");
      const sqlRan = request.toolResults.some((result) => result.name === "run_sql");
      const reporterRan = request.toolResults.some((result) => result.name === "reporter");
      const reporterAvailable = request.tools.some((tool) => tool.name === "reporter");

      if (mustLoadSkill && !skillLoaded) {
        return {
          toolCalls: [{ name: "load_skill", input: { skill: "revenue-definitions" } }],
        };
      }
      if (!sqlRan) {
        return {
          toolCalls: [
            {
              name: "run_sql",
              input: {
                query:
                  "SELECT SUM(amount_usd) AS total_revenue FROM payments WHERE status = 'settled'",
              },
            },
          ],
        };
      }
      if (mustDelegateSummary && reporterAvailable && !reporterRan) {
        return {
          toolCalls: [
            {
              name: "reporter",
              input: { message: "Summarize the revenue finding: TOTAL_REVENUE=42" },
            },
          ],
        };
      }
      return {
        text: "Recognized quarterly revenue: TOTAL_REVENUE=42 (settled payments only).",
      };
    },
  });
}

const demoModel = resolveDemoModel(buildMockModel);

export default defineAgent({
  // The mock model id is not in the AI Gateway catalog, so eve cannot resolve
  // a context window for compaction; supply one explicitly — mock mode only.
  // Real gateway ids resolve their window from the catalog (eve's docs prefer
  // leaving the override unset so metadata stays in sync with the provider).
  ...(demoModel.isMock ? { modelContextWindowTokens: 200_000 } : {}),
  model: demoModel.model,
});
