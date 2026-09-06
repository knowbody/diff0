import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  description: "Always fail for retry enforcement verification",
  modelContextWindowTokens: 200000,
  model: mockModel(() => {
    throw new Error("deliberate station failure");
  }),
});
