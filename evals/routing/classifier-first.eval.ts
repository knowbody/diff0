import { defineEval } from "eve/evals";
import { calledInOrder } from "../helpers.js";

export default defineEval({
  description:
    "A work item enters the pipeline through the classifier before any analysis happens, and an explicit stop-after-analysis instruction keeps the implementer idle.",
  tags: ["slow", "needs-connect"],
  async test(t) {
    await t.send(
      "Work item: users report that password reset emails sometimes arrive twice. Classify this and produce the implementation plan, but stop after analysis and report the plan to me; do not implement anything yet.",
    );
    t.succeeded();
    t.calledTool("run_station", { input: { station: "classifier" } });
    t.calledTool("run_station", { input: { station: "analyst" } });
    t.eventsSatisfy(
      "implementer is not invoked",
      (events) =>
        !events.some(
          (event) => event.type === "subagent.called" && event.data.name === "implementer",
        ),
    );
    t.eventsSatisfy("classifier is delegated to before the analyst", (events) =>
      calledInOrder(events, ["classifier", "analyst"]),
    );
  },
});
