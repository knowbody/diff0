import { defineEval } from "eve/evals";
export default defineEval({
  timeoutMs: 30000,
  async test(t) {
    await t.send("direct");
    t.eventsSatisfy("no child was started", (events) => !events.some((e) => e.type === "subagent.started"));
    t.eventsSatisfy("unsafe delegation was rejected", (events) => events.some((e) =>
      (e.type === "turn.failed" || e.type === "session.failed") && JSON.stringify(e).includes("through run_station"),
    ));
  },
});
