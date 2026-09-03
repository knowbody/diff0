import { defineTool } from "eve/tools";
import { z } from "zod";
import { FACTORY_BRANCH_PREFIX } from "../../../lib/constants.js";
import { REPO_DIR } from "../../../lib/github/git-remote.js";
import { publishSandboxCommit } from "../../../lib/github/runtime-push.js";

/**
 * Publishes a committed sandbox diff through trusted GitHub API calls.
 *
 * @remarks
 * The model-controlled sandbox never receives a write credential. Trusted
 * runtime code validates branch ownership, the immutable remote base, changed
 * paths, file kinds, and size bounds before creating one fast-forward commit.
 */
export default defineTool({
  description: `Publish the committed changes in ${REPO_DIR} to a session-owned ${FACTORY_BRANCH_PREFIX} branch. The trusted runtime may add an ownership token to a new branch name; always report the returned branch name to the orchestrator.`,
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    try {
      const result = await publishSandboxCommit({
        requestedBranch: input.branch,
        rootSessionId,
        sandbox,
        signal: ctx.abortSignal,
      });
      return {
        branch: result.branch,
        changedFiles: result.changedFiles,
        sha: result.sha,
        success: true as const,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not publish the branch.",
        success: false as const,
      };
    }
  },
  inputSchema: z.object({
    branch: z
      .string()
      .min(1)
      .describe("Branch name in /workspace/repo to push, e.g. eve/bug-dedupe-reset-emails"),
  }),
});
