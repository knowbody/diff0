import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateBranch } from "../../../lib/github/git-remote.js";
import {
  reviewCheckPlan,
  reviewChecks,
  runNextReviewCheck,
} from "../../../lib/github/review-checks.js";
import { isOwnedBranch } from "../../../lib/github/runtime-push.js";

export default defineTool({
  description:
    "Run the next required repository check for the reviewed commit. Call sequentially until complete is true, then call attest_review. Each call runs one bounded check and saves its result durably. Do not repeat the full suite manually.",
  inputSchema: z.object({ branch: z.string().min(1) }),
  outputSchema: z.object({
    success: z.boolean(),
    complete: z.boolean(),
    checks: z.array(z.string()).optional(),
    nextCheck: z.string().optional(),
    error: z.string().optional(),
  }),
  async execute({ branch }, ctx) {
    const root = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    if (!isOwnedBranch(branch, root) || validateBranch(branch))
      return {
        success: false,
        complete: false,
        error: "That branch is not owned by this agent session.",
      };
    try {
      const sandbox = await ctx.getSandbox();
      const next = await runNextReviewCheck(sandbox, branch, reviewChecks.get());
      reviewChecks.update(() => next);
      const plan = await reviewCheckPlan(sandbox);
      const nextCheck = plan.checks[next.passed.length];
      return { success: true, complete: nextCheck === undefined, checks: next.passed, nextCheck };
    } catch (error) {
      return {
        success: false,
        complete: false,
        error: error instanceof Error ? error.message : "Required review check failed.",
      };
    }
  },
});
