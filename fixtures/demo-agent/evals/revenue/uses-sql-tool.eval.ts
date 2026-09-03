import { defineEval } from "eve/evals";

export default defineEval({
  description: "Computes revenue with the run_sql tool instead of guessing.",
  async test(t) {
    await t.send("How much revenue did we recognize this quarter?");
    t.succeeded();
    t.calledTool("run_sql");
  },
});
