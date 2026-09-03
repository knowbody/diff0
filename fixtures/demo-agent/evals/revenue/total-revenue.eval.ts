import { defineEval } from "eve/evals";

export default defineEval({
  description: "Answers a revenue question with the canonical total.",
  tags: ["fast"],
  async test(t) {
    await t.send("What was our total revenue last quarter?");
    t.succeeded();
    t.messageIncludes("TOTAL_REVENUE=42");
  },
});
