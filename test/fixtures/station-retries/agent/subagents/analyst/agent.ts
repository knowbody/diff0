import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  description: "Deterministic station for delegation verification",
  modelContextWindowTokens: 200000,
  model: mockModel(({ messages }) => {
    if (messages.some((message) => message.text.includes("succeed"))) return "Station completed.";
    throw new Error("deliberate station failure");
  }),
});
