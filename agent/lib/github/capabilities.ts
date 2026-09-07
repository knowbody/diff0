import { type GithubToolName, GITHUB_WRITE_TOOLS as SDK_WRITE_TOOLS } from "@github-tools/sdk";

/** One mounted inventory; SDK metadata identifies which capabilities mutate GitHub. */
export const GITHUB_MOUNTED_TOOLS = [
  "getRepository",
  "getRepositoryTree",
  "getFileContent",
  "searchCode",
  "listBranches",
  "listCommits",
  "getCommit",
  "compareCommits",
  "searchIssues",
  "listIssues",
  "getIssueContext",
  "listIssueComments",
  "createIssue",
  "updateIssue",
  "closeIssue",
  "addIssueComment",
  "listLabels",
  "addLabels",
  "removeLabel",
  "addAssignees",
  "removeAssignees",
  "listPullRequests",
  "getPullRequestContext",
  "listPullRequestFiles",
  "listPullRequestReviews",
  "createPullRequest",
  "updatePullRequest",
  "addPullRequestComment",
  "requestReviewers",
  "listCheckRuns",
  "getCiFailureContext",
] as const satisfies readonly GithubToolName[];

export const MOUNTED_GITHUB_WRITES = GITHUB_MOUNTED_TOOLS.filter((name) => name in SDK_WRITE_TOOLS);
export const ROOT_WRITE_TOOLS = ["update_factory_brain"] as const;
