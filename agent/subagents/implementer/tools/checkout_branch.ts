import { defineTool } from "eve/tools";
import { z } from "zod";
import { checkoutOwnedBranch } from "../../../lib/github/checkout.js";
import { BASE_MARKER_PATH } from "../../../lib/github/runtime-push.js";

export default defineTool({
  description: "Fetch a session-owned published branch and check it out. Use on revision runs.",
  inputSchema: z.object({ branch: z.string().min(1) }),
  outputSchema: z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), branch: z.string(), sha: z.string() }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]),
  async execute({ branch }, ctx) {
    try {
      const sandbox = await ctx.getSandbox();
      const result = await checkoutOwnedBranch(
        sandbox,
        branch,
        ctx.session.parent?.rootSessionId ?? ctx.session.id,
      );
      // A revision starts from this publication; reviewers retain the original baseline.
      await sandbox.writeTextFile({ path: BASE_MARKER_PATH, content: JSON.stringify(result) });
      return { ...result, success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Branch checkout failed.",
      };
    }
  },
});
