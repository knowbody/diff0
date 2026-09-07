import { getGitHubRef } from "./api.js";
import { githubCredentials } from "./credentials.js";
import { mintInstallationToken, validateBranch } from "./git-remote.js";
import { saveReviewAttestation } from "./review-attestation.js";
import {
  type ReviewChecks,
  type ReviewSandbox,
  requireReviewChecks,
  reviewCheckPlan,
  reviewedSha,
} from "./review-checks.js";
import { isOwnedBranch } from "./runtime-push.js";

/** Persist approval only for the independently checked, still-clean remote commit. */
export async function attestReviewedCommit(input: {
  branch: string;
  rootSessionId: string;
  sandbox: ReviewSandbox;
  current: ReviewChecks | null;
  signal?: AbortSignal;
}): Promise<{ branch: string; sha: string; checks: string[] }> {
  const { branch, rootSessionId, sandbox } = input;
  if (!isOwnedBranch(branch, rootSessionId))
    throw new Error("That branch is not owned by this agent session.");
  const refusal = validateBranch(branch);
  if (refusal) throw new Error(refusal);
  const sha = await reviewedSha(sandbox, branch);
  const checks = requireReviewChecks(input.current, branch, sha, await reviewCheckPlan(sandbox));
  const token = await mintInstallationToken(githubCredentials);
  const remote = await getGitHubRef(`heads/${branch}`, { signal: input.signal, token });
  if (remote?.object.sha !== sha) throw new Error("The remote branch moved during review.");
  if ((await reviewedSha(sandbox, branch)) !== sha)
    throw new Error("The reviewer checkout changed during verification.");
  await saveReviewAttestation(rootSessionId, { branch, sha });
  return { branch, sha, checks };
}
