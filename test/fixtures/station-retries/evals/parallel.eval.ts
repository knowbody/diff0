import { defineEval } from "eve/evals";
export default defineEval({
  timeoutMs: 30000,
  async test(t) {
    await t.send("parallel");
    t.eventsSatisfy("at most one child was started", (events) => events.filter((e) => e.type === "subagent.called").length <= 1);
    t.eventsSatisfy("unsafe delegation was rejected", (events) => events.some((e) =>
      (e.type === "turn.failed" || e.type === "session.failed") && JSON.stringify(e).includes("sequentially"),
    ));
  },
});
