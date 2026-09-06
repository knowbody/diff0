import { defineEval } from "eve/evals";
export default defineEval({
  timeoutMs: 60000,
  async test(t) {
    await t.send("Try repeatedly until stopped.");
    t.calledSubagent("analyst", { status: "failed", count: 2 });
    t.eventsSatisfy(
      "runtime stops before a third delegation",
      (events) => events.filter((e) => e.type === "subagent.called").length === 2,
    );
    t.eventsSatisfy("runtime surfaces exhausted retry", (events) =>
      events.some(
        (e) =>
          (e.type === "turn.failed" || e.type === "session.failed") &&
          JSON.stringify(e).includes("one retry is exhausted"),
      ),
    );
  },
});
