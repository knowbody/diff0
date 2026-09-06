import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  modelContextWindowTokens: 200000,
  model: mockModel(() => ({
    toolCalls: [{ name: "analyst", input: { message: "deliberate failure" } }],
  })),
});
