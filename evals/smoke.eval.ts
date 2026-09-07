import { defineEval } from "eve/evals";
import { WRITE_TOOLS } from "./helpers.js";

export default defineEval({
  description:
    "A greeting doesn't spin up the factory line: the agent answers directly, delegates nothing to the implementer, and writes nothing to GitHub.",
  tags: ["fast"],
  async test(t) {
    await t.send("Hi! What are you and what can you do for me on this repository?");
    t.succeeded();
    t.eventsSatisfy(
      "implementer is not invoked",
      (events) =>
        !events.some(
          (event) => event.type === "subagent.called" && event.data.name === "implementer",
        ),
    );
    t.eventsSatisfy(
      "reviewer is not invoked",
      (events) =>
        !events.some((event) => event.type === "subagent.called" && event.data.name === "reviewer"),
    );
    for (const tool of WRITE_TOOLS) {
      t.notCalledTool(tool);
    }
  },
});
