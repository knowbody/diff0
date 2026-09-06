import { randomUUID } from "node:crypto";
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

// Credential-free, controlled outcomes with deliberately variable text/inputs.
// This exercises Eve's real HTTP server and event capture, not diff0 internals.
export default defineAgent({
  modelContextWindowTokens: 200_000,
  model: mockModel({
    modelId: "calibration",
    respond(request) {
      const instructions = request.messages.filter(m => m.role === "system").map(m => m.text).join("\n");
      if (!instructions.includes("Skip lookup.") && !request.toolResults.some(r => r.name === "lookup")) {
        return { toolCalls: [{ name: "lookup", input: { requestId: randomUUID() } }] };
      }
      const value = instructions.includes("Return the wrong answer.") ? 0 : 42;
      return { text: `VALUE=${value}; request ${randomUUID()}` };
    },
  }),
});
