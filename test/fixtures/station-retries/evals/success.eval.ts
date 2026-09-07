import { defineEval } from "eve/evals";

export default defineEval({
  timeoutMs: 30000,
  async test(t) {
    await t.send("success");
    await t.send("success");
    t.succeeded();
    t.calledTool("run_station", { count: 4, output: "Station completed." });
  },
});
