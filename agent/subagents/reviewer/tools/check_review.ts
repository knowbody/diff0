import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateBranch } from "../../../lib/github/git-remote.js";
import {
  reviewCheckPlan,
  reviewChecks,
  runNextReviewCheck,
} from "../../../lib/github/review-checks.js";
import { reviewTarget } from "../../../lib/github/review-target.js";
import { isOwnedBranch } from "../../../lib/github/runtime-push.js";

export default defineTool({
  description:
    "Run the next required repository check for the reviewed commit. Call sequentially until complete is true, then call attest_review. Each call runs one bounded check and saves its result durably. Do not repeat the full suite manually.",
  inputSchema: z.object({ branch: z.string().min(1) }),
  outputSchema: z.union([
    z.object({ success: z.literal(false), complete: z.literal(false), error: z.string() }),
    z.object({ success: z.literal(true), complete: z.literal(true), checks: z.array(z.string()) }),
    z.object({
      success: z.literal(true),
      complete: z.literal(false),
      checks: z.array(z.string()),
      nextCheck: z.string(),
    }),
  ]),
  async execute({ branch }, ctx) {
    const root = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    if (!isOwnedBranch(branch, root) || validateBranch(branch))
      return {
        success: false as const,
        complete: false as const,
        error: "That branch is not owned by this agent session.",
      };
    try {
      const sandbox = await ctx.getSandbox();
      const next = await runNextReviewCheck(
        sandbox,
        branch,
        reviewChecks.get(),
        reviewTarget.get(),
      );
      reviewChecks.update(() => next);
      const plan = reviewCheckPlan(reviewTarget.get());
      const nextCheck = plan.checks[next.passed.length];
      return nextCheck === undefined
        ? { success: true as const, complete: true as const, checks: next.passed }
        : { success: true as const, complete: false as const, checks: next.passed, nextCheck };
    } catch (error) {
      return {
        success: false as const,
        complete: false as const,
        error: error instanceof Error ? error.message : "Required review check failed.",
      };
    }
  },
});
