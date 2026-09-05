import githubExtension from "@github-tools/eve-extension";
import { factoryRepo } from "../../lib/constants.js";
import { GITHUB_CONNECTOR } from "../../lib/github/credentials.js";
import { githubApproval, githubModelOutput } from "../../lib/github/runtime-callbacks.js";

/**
 * GitHub tool surface for the orchestrator, mounted as an eve extension.
 *
 * @remarks
 * - Tools appear to the model as `github__<name>`; credentials are brokered
 *   by Vercel Connect through {@link GITHUB_CONNECTOR}, resolved per call and
 *   never exposed to the model. `context` fills `owner`/`repo` from
 *   `FACTORY_REPO` so tool calls omit them.
 * - `include` is the allowlist; there is no preset. Reads, triage writes, and
 *   PR authoring are in; merge tools are deliberately absent (a person merges
 *   in the GitHub UI), and so are repo administration, gists (they 403 over
 *   Connect installation tokens), releases, and CI mutation.
 * - `requireApproval` doubles as the authorization policy
 *   (`agent/lib/github/approval.ts`): trusted callers run reversible writes
 *   without a card, unattended factory runs are denied everything except
 *   labels, progress comments, and lifecycle updates on their own intake
 *   issue, plus draft pull requests (a card would strand them). Only shipping
 *   (marking a non-draft or ready-for-review PR) parks for a person no matter
 *   who asks. Write tools not listed here would keep the SDK's
 *   approval-by-default.
 */
export const githubOptions = {
  connector: GITHUB_CONNECTOR,
  context: factoryRepo,
  // The SDK's formatter closures lack Eve durable descriptors. Without these
  // authored callbacks, one invalid formatter drops the entire GitHub tool set.
  overrides: {
    compareCommits: { toModelOutput: githubModelOutput },
    getCommit: { toModelOutput: githubModelOutput },
    getFileContent: { toModelOutput: githubModelOutput },
    getPullRequestContext: { toModelOutput: githubModelOutput },
    listPullRequestFiles: { toModelOutput: githubModelOutput },
  },
  include: [
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
  ],
  requireApproval: {
    addAssignees: githubApproval("write"),
    addIssueComment: githubApproval("comment"),
    addLabels: githubApproval("label"),
    addPullRequestComment: githubApproval("write"),
    closeIssue: githubApproval("close"),
    createIssue: githubApproval("write"),
    createPullRequest: githubApproval("createPullRequest"),
    removeAssignees: githubApproval("write"),
    removeLabel: githubApproval("label"),
    requestReviewers: githubApproval("write"),
    updateIssue: githubApproval("updateIssue"),
    updatePullRequest: githubApproval("ship"),
  },
} satisfies Parameters<typeof githubExtension>[0];

export default githubExtension(githubOptions);
