import { defineState } from "eve/context";
import { z } from "zod";
import { getGitHubRef, githubApi } from "./api.js";
import { githubCredentials } from "./credentials.js";
import {
  fetchFactoryRepositoryMetadata,
  mintInstallationToken,
  validateBranch,
} from "./git-remote.js";
import { isOwnedBranch } from "./runtime-push.js";

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const comparisonSchema = z.object({
  merge_base_commit: z.object({ sha: shaSchema }),
  files: z.array(
    z.object({ filename: z.string().min(1), previous_filename: z.string().optional() }),
  ),
});

export interface ReviewTarget {
  branch: string;
  sha: string;
  baseSha: string;
  paths: string[];
}

/** Only checkout_branch writes this slot; sandbox files never supply review policy. */
export const reviewTarget = defineState<ReviewTarget | null>("diff0.review-target.v1", () => null);

/** Resolve the actual PR diff from GitHub, including changes across revision commits. */
export async function fetchReviewTarget(
  branch: string,
  rootSessionId: string,
  signal?: AbortSignal,
): Promise<ReviewTarget> {
  if (!isOwnedBranch(branch, rootSessionId) || validateBranch(branch))
    throw new Error("That branch is not owned by this agent session.");
  const token = await mintInstallationToken(githubCredentials);
  const { defaultBranch } = await fetchFactoryRepositoryMetadata(token);
  const base = await getGitHubRef(`heads/${defaultBranch}`, { token, signal });
  const head = await getGitHubRef(`heads/${branch}`, { token, signal });
  const baseSha = shaSchema.parse(base?.object.sha);
  const sha = shaSchema.parse(head?.object.sha);
  const comparison = comparisonSchema.parse(
    await githubApi("GET", `/compare/${baseSha}...${sha}?per_page=1`, { token, signal }),
  );
  // GitHub caps comparison files at 300, including on paginated requests.
  // At the cap completeness cannot be proved; never silently weaken checks.
  if (comparison.files.length >= 300)
    throw new Error(
      "Review diff may be truncated by GitHub. Split this change into smaller branches.",
    );
  if (comparison.files.length === 0 || comparison.merge_base_commit.sha === sha)
    throw new Error("The branch has no changes to review against the default branch.");
  return {
    branch,
    sha,
    baseSha: comparison.merge_base_commit.sha,
    paths: comparison.files.flatMap((file) =>
      file.previous_filename ? [file.filename, file.previous_filename] : [file.filename],
    ),
  };
}
