import { defineEval } from "eve/evals";

export default defineEval({
  description: "Completes a revenue request without any failed tool calls.",
  async test(t) {
    await t.send("Report total revenue for the last quarter.");
    t.succeeded();
    t.noFailedActions();
  },
});
