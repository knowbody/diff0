import { defineEval } from "eve/evals";
import { calledInOrder, requireMutatingEvalRepository, STATIONS } from "../helpers.js";

export default defineEval({
  description:
    "Investigate the seeded GitHub-tool registration regression in a disposable diff0 copy, add regression coverage, and deliver an independently reviewed draft PR.",
  tags: ["slow", "needs-connect", "pipeline", "mutating"],
  timeoutMs: 1_800_000,
  async test(t) {
    requireMutatingEvalRepository();
    await t.send(
      [
        "Work item: the maintenance agent in this repository can pass its greeting eval while losing its entire GitHub tool set at runtime.",
        'Observed with Eve 0.47.5 and @github-tools/eve-extension 0.3.2: Dynamic tool "github__getFileContent" callback "toModelOutput" does not have a durable descriptor. The dynamic resolver skips its complete result.',
        "Investigate the repository and reproduce the failure with a deterministic test that requires no production credentials or external writes. Fix the integration and add regression coverage proving the configured GitHub tools resolve, retain their github__ names, and keep write approvals intact. A greeting-only assertion is insufficient.",
        "Preserve the existing tool allowlist, trust policies, output truncation, and draft-only publication boundary. Do not weaken authorization or replace live tools with mocks in the production agent.",
        "Run the classifier, analyst, implementer, and independent reviewer. Deliver the reviewed change as a draft pull request in this disposable repository. Report the reproduction, verification commands and results, reviewer verdict, and draft PR URL. Do not mark ready or merge.",
      ].join("\n\n"),
    );
    t.succeeded();
    for (const station of STATIONS) t.calledSubagent(station);
    t.eventsSatisfy("stations ran in pipeline order", (events) =>
      calledInOrder(events, [...STATIONS]),
    );
    t.calledTool("github__createPullRequest", { input: { draft: true } });
  },
});
