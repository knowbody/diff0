import { defineTool } from "eve/tools";
import { z } from "zod";
import { getGitHubRef } from "../../../lib/github/api.js";
import { githubCredentials } from "../../../lib/github/credentials.js";
import { mintInstallationToken, REPO_DIR, validateBranch } from "../../../lib/github/git-remote.js";
import { saveReviewAttestation } from "../../../lib/github/review-attestation.js";
import { isOwnedBranch } from "../../../lib/github/runtime-push.js";

const SHA_PATTERN = /^[a-f0-9]{40}$/;

/** Record the exact clean remote commit that the independent reviewer approved. */
export default defineTool({
  description:
    "Attest the exact branch commit you approved. Call this only after all review checks pass, " +
    "immediately before returning an approve verdict. A draft PR cannot open without it.",
  async execute(input, ctx) {
    const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    if (!isOwnedBranch(input.branch, rootSessionId)) {
      return { error: "That branch is not owned by this agent session.", success: false as const };
    }
    const refusal = validateBranch(input.branch);
    if (refusal) return { error: refusal, success: false as const };

    const sandbox = await ctx.getSandbox();
    const status = await sandbox.run({ command: `git -C ${REPO_DIR} status --porcelain` });
    const branchResult = await sandbox.run({
      command: `git -C ${REPO_DIR} branch --show-current`,
    });
    const shaResult = await sandbox.run({ command: `git -C ${REPO_DIR} rev-parse HEAD` });
    const branch = String(branchResult.stdout).trim();
    const sha = String(shaResult.stdout).trim();
    if (
      status.exitCode !== 0 ||
      String(status.stdout).trim() !== "" ||
      branchResult.exitCode !== 0 ||
      shaResult.exitCode !== 0 ||
      branch !== input.branch ||
      !SHA_PATTERN.test(sha)
    ) {
      return {
        error: "The reviewer checkout is not clean and pinned to the requested branch.",
        success: false as const,
      };
    }

    const token = await mintInstallationToken(githubCredentials);
    const remote = await getGitHubRef(`heads/${input.branch}`, { signal: ctx.abortSignal, token });
    if (remote?.object.sha !== sha) {
      return { error: "The remote branch moved during review.", success: false as const };
    }
    await saveReviewAttestation(rootSessionId, { branch: input.branch, sha });
    return { branch: input.branch, sha, success: true as const };
  },
  inputSchema: z.object({
    branch: z.string().min(1).describe("The session-owned branch that passed review."),
  }),
  outputSchema: z.object({
    branch: z.string().optional(),
    error: z.string().optional(),
    sha: z.string().optional(),
    success: z.boolean(),
  }),
});
