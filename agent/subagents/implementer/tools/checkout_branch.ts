import { defineTool } from "eve/tools";
import { z } from "zod";
import { githubCredentials } from "../../../lib/github/credentials.js";
import {
  brokerPolicy,
  fetchFactoryRepositoryMetadata,
  mintInstallationToken,
  REMOTE_URL,
  REPO_DIR,
  validateBranch,
} from "../../../lib/github/git-remote.js";
import { BASE_MARKER_PATH, isOwnedBranch } from "../../../lib/github/runtime-push.js";

/**
 * Fetches an existing factory branch and checks it out in the sandbox, for
 * revision runs that continue work the reviewer sent back.
 *
 * @remarks
 * The fetch targets the factory repository's URL literally with a credential
 * brokered at the sandbox firewall (never entering the sandbox), mirroring
 * `push_branch`. `validateBranch` bounds what can be interpolated into the
 * git command line.
 */
export default defineTool({
  description: `Fetch an existing branch of the factory repository and check it out in ${REPO_DIR}. Use this on a revision run, when the reviewer's findings name a branch that already exists; fresh work starts from the default branch with plain git instead.`,
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    const rootSessionId = ctx.session.parent?.rootSessionId ?? ctx.session.id;
    if (!isOwnedBranch(input.branch, rootSessionId)) {
      return { error: "That branch is not owned by this agent session.", success: false as const };
    }
    const token = await mintInstallationToken(githubCredentials);
    const { defaultBranch } = await fetchFactoryRepositoryMetadata(token);
    const refusal = validateBranch(input.branch, defaultBranch);
    if (refusal) {
      return { error: refusal, success: false as const };
    }
    await sandbox.setNetworkPolicy(brokerPolicy(token));
    try {
      const fetch = await sandbox.run({
        command: `git -C ${REPO_DIR} fetch ${REMOTE_URL} '${input.branch}' && git -C ${REPO_DIR} checkout -B '${input.branch}' FETCH_HEAD`,
      });
      if (fetch.exitCode !== 0) {
        return {
          error: `git fetch/checkout exited ${fetch.exitCode}: ${String(
            fetch.stderr || fetch.stdout,
          ).trim()}`,
          success: false as const,
        };
      }
      const head = await sandbox.run({
        command: `git -C ${REPO_DIR} rev-parse HEAD`,
      });
      const sha = String(head.stdout).trim();
      if (head.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(sha)) {
        return { error: "Could not resolve the fetched branch head.", success: false as const };
      }
      await sandbox.writeTextFile({
        content: JSON.stringify({ branch: input.branch, sha }),
        path: BASE_MARKER_PATH,
      });
      return {
        branch: input.branch,
        sha,
        success: true as const,
      };
    } finally {
      await sandbox.setNetworkPolicy("deny-all");
    }
  },
  inputSchema: z.object({
    branch: z.string().min(1).describe("The existing branch to fetch and check out."),
  }),
});
