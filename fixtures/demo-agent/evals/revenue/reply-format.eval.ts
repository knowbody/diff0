import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Reply carries the canonical TOTAL_REVENUE figure.",
  async test(t) {
    await t.send("Give me the quarterly revenue number.");
    t.check(t.reply, includes("TOTAL_REVENUE=42"));
  },
});
