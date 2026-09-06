import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Bind a paid comparison to the exact same-repository commit the owner reviewed. */
export function validateReviewedPullRequest(pr, repository, reviewedSha, expectedBaseSha) {
  if (!/^[a-f0-9]{40}$/.test(reviewedSha ?? "")) {
    throw new Error("Supply the full 40-character commit SHA you reviewed.");
  }
  if (pr.state !== "open") throw new Error("The pull request must still be open.");
  if (pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) {
    throw new Error("Reviewed comparisons accept only branches inside this repository.");
  }
  if (!pr.base.repo.default_branch || pr.base.ref !== pr.base.repo.default_branch) {
    throw new Error("The comparison base must be the repository's default branch.");
  }
  if (pr.head.sha !== reviewedSha) {
    throw new Error("The pull request head changed. Review the new commit and dispatch again.");
  }
  if (!/^[a-f0-9]{40}$/.test(pr.base.sha ?? "")) throw new Error("Invalid PR base SHA.");
  if (expectedBaseSha && pr.base.sha !== expectedBaseSha) {
    throw new Error("The pull request base changed during the comparison; dispatch again.");
  }
  return { baseSha: pr.base.sha, headSha: pr.head.sha };
}

async function main() {
  const { GITHUB_REPOSITORY, GH_TOKEN, PR_NUMBER, REVIEWED_SHA, EXPECTED_BASE_SHA } = process.env;
  if (!GITHUB_REPOSITORY || !GH_TOKEN || !/^[1-9][0-9]*$/.test(PR_NUMBER ?? "")) {
    throw new Error("Repository, GitHub token, and a positive PR number are required.");
  }
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`Could not inspect PR #${PR_NUMBER}: HTTP ${response.status}`);
  const refs = validateReviewedPullRequest(
    await response.json(),
    GITHUB_REPOSITORY,
    REVIEWED_SHA,
    EXPECTED_BASE_SHA,
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `base-sha=${refs.baseSha}\nhead-sha=${refs.headSha}\n`);
  }
  console.log(`Verified PR #${PR_NUMBER}: ${refs.baseSha}...${refs.headSha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
