import { defineEval } from "eve/evals";
import { calledInOrder, requireMutatingEvalRepository, STATIONS } from "../helpers.js";

export default defineEval({
  description:
    "Deliver an independently reviewed draft PR fixing tiny positive cost display in a disposable repository.",
  tags: ["slow", "needs-connect", "pipeline", "mutating"],
  timeoutMs: 1_800_000,
  async test(t) {
    requireMutatingEvalRepository();
    await t.send(
      [
        "Work item: src/report/format.ts formatUsd can render a positive model cost as $0.0000, which looks free.",
        "For finite values strictly greater than zero and strictly less than 0.0001, return the literal string <$0.0001. Keep zero formatted as $0.0000, exactly 0.0001 as $0.0001, and existing formatting at and above one dollar unchanged. Preserve other behavior. Add focused regression tests for these boundaries and update the helper comment.",
        "This is a small formatting fix. Use existing dependencies only; no dependency upgrades, external research, or unrelated refactors. The sandbox is offline after bootstrap. If a required check cannot run because of a missing prerequisite, report it promptly rather than retrying network requests.",
        "Run classification, analysis, implementation, and independent review. Run the relevant repository checks and deterministic demo comparison with DIFF0_DEMO_MODEL=mock. Rebuild the checked-in Action bundle if required. Publish a session-owned branch and open an independently reviewed draft PR in the configured disposable repository. Report verification and the actual PR URL. Never mark ready or merge.",
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
