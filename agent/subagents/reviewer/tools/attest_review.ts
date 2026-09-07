import { defineTool } from "eve/tools";
import { z } from "zod";
import { attestReviewedCommit } from "../../../lib/github/attest.js";
import { reviewChecks } from "../../../lib/github/review-checks.js";

export default defineTool({
  description:
    "Attest the exact clean branch commit you approved after check_review completes. A draft PR cannot open without it.",
  async execute({ branch }, ctx) {
    try {
      const result = await attestReviewedCommit({
        branch,
        rootSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
        sandbox: await ctx.getSandbox(),
        current: reviewChecks.get(),
        signal: ctx.abortSignal,
      });
      return { ...result, success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Review attestation failed.",
      };
    }
  },
  inputSchema: z.object({
    branch: z.string().min(1).describe("The session-owned branch that passed review."),
  }),
  outputSchema: z.discriminatedUnion("success", [
    z.object({
      success: z.literal(true),
      branch: z.string(),
      checks: z.array(z.string()),
      sha: z.string(),
    }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]),
});
