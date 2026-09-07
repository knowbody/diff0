import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "An ambiguous work item stops the pipeline at classification: the agent asks the requester instead of building on guesses, and nothing reaches the implementer.",
  tags: ["slow"],
  async test(t) {
    await t.send(
      "Something is wrong with the emails, you know the one I mean. Fix it properly this time.",
    );
    t.calledTool("run_station", { input: { station: "classifier" } });
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
    t.judge.autoevals
      .closedQA(
        "Does the submission ask the user specific clarifying questions about which email problem they mean, rather than proceeding to build something or claiming work was done?",
        { on: t.reply ?? "(the run parked on a question instead of replying)" },
      )
      .soft(0.5);
  },
});
