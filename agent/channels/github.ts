import {
  defaultGitHubAuth,
  type GitHubComment,
  type GitHubInboundContext,
  githubChannel,
} from "eve/channels/github";
import { FACTORY_LABEL } from "../lib/constants.js";
import { mentionPattern, resolveBotName } from "../lib/github/bot-name.js";
import { githubCredentials } from "../lib/github/credentials.js";
import { claimIntakeLatch, clearIntakeLatch } from "../lib/github/intake-latch.js";
import { isFactoryRepository } from "../lib/github/provenance.js";
import { stampAutonomous, stampTrusted } from "../lib/trust.js";

/**
 * Replicates the channel's built-in ignore rules: eve's own marker comments,
 * bot authors, and the agent's own `<bot>[bot]` login.
 */
const isIgnoredComment = (comment: GitHubComment, botName: string): boolean => {
  if (comment.body.includes("<!-- eve:github:")) {
    return true;
  }
  const { author } = comment;
  if (author === undefined) {
    return false;
  }
  return author.type === "Bot" || author.login.toLowerCase() === `${botName.toLowerCase()}[bot]`;
};

/**
 * Repository roles allowed to hand an issue to the factory by labeling it.
 *
 * @remarks
 * GitHub's fine-grained role names from the collaborator-permission endpoint.
 * Triage is the floor: it is the permission normally required to apply a
 * label by hand.
 */
const TRUSTED_LABELER_ROLES = new Set(["admin", "maintain", "write", "triage"]);
const TRUSTED_WRITER_ROLES = new Set(["admin", "maintain", "write"]);

async function repositoryRole(ctx: GitHubInboundContext): Promise<string | null> {
  const response = await ctx.github.request<{
    permission?: string;
    role_name?: string;
  }>({
    method: "GET",
    path: `/repos/${ctx.repository.owner}/${ctx.repository.name}/collaborators/${encodeURIComponent(ctx.sender.login)}/permission`,
  });
  const role = response.body.role_name ?? response.body.permission;
  return typeof role === "string" ? role : null;
}

/** A mention may start an attended session only for a verified repository writer. */
export async function isTrustedCommenter(ctx: GitHubInboundContext): Promise<boolean> {
  const role = await repositoryRole(ctx);
  return role !== null && TRUSTED_WRITER_ROLES.has(role);
}

/**
 * Whether the webhook sender holds at least triage permission on the repo.
 *
 * @remarks
 * The issues webhook carries the issue author's association, never the
 * labeler's, and GitHub fires the `labeled` action even for labels attached
 * at creation time, which issue templates let unauthenticated reporters do.
 * Verifying the sender's permission against the API is what keeps the
 * unattended pipeline maintainer-triggered. API failures propagate into
 * Eve's delivery log instead of being misreported as an authorization miss.
 */
const isTrustedLabeler = async (ctx: GitHubInboundContext): Promise<boolean> => {
  const role = await repositoryRole(ctx);
  return role !== null && TRUSTED_LABELER_ROLES.has(role);
};

/**
 * Task injected into an unattended intake session (an issue labeled with the
 * factory label). The issue's content is already in the session's context
 * when this runs.
 */
const FACTORY_INTAKE_TASK = [
  `This issue was handed to the factory with the "${FACTORY_LABEL}" label, and this run is unattended: nobody is watching to answer a question or approve an action, so never use ask_question and never attempt an action that needs approval.`,
  `Run the work item through the full pipeline. If the classifier needs clarification, post its questions as a comment, remove the "${FACTORY_LABEL}" label to rearm intake, and stop; someone can apply it again after answering.`,
  "Keep the requester in the loop as you go: post a short comment on this issue when a station completes, except the last one. Comments on this issue are the one conversational write this run has; you cannot comment anywhere else.",
  `Deliver the finished work as a draft pull request, then remove the "${FACTORY_LABEL}" label to rearm intake. The message you end the run with appears on this issue for you: link the pull request there, and let it stand in for the progress comment for this final step.`,
].join("\n\n");

/**
 * GitHub channel: the factory's main intake and delivery surface, as
 * "diff0 Eve".
 *
 * @remarks
 * - Credentials are brokered by Vercel Connect through the shared handle in
 *   `agent/lib/github/credentials.ts`; tokens are resolved per call and never
 *   exposed to the model.
 * - The name the factory answers to is resolved from the GitHub App's own
 *   slug (`agent/lib/github/bot-name.ts`), so the mention follows whatever
 *   the deployer named their app with no configuration, and a hardcoded
 *   handle can't collide with an unrelated GitHub user. `botName` is passed
 *   as the resolver function, not a resolved value: eve calls it on first
 *   use inside request handling, where the deployment's OIDC token exists
 *   (at module load it doesn't, so a value resolved here would pin the
 *   fallback), caches a fulfilled name, and retries a rejection on the next
 *   event.
 * - `onComment` replaces the built-in mention gate to add an authorization
 *   check: it keeps the default mention and ignore rules, then dispatches
 *   only when GitHub verifies that the commenter has write, maintain, or
 *   admin permission on the repository. The dispatch stamps the
 *   `trusted` auth attribute, which is what lets the approval policies run
 *   reversible writes without a card. Mentions from anyone else are
 *   acknowledged without a session, so arbitrary accounts on a public repo
 *   cannot drive the agent's write tools.
 * - `onIssue` is the unattended intake: adding the factory label hands the
 *   issue to the pipeline. Only the `labeled` action dispatches, and the
 *   labeler's repository permission is verified against the API first,
 *   because GitHub fires `labeled` even for labels attached at creation time
 *   and issue templates let unauthenticated reporters do exactly that; below
 *   triage, the event is acknowledged without a session. The factory label is
 *   matched against the issue's current `labels` array because eve exposes
 *   the issue object, not the webhook's added-label field. A private,
 *   atomically-created issue latch makes intake single-use while the label is
 *   present, preventing concurrent delivery and later routine label changes
 *   from starting another pipeline. Removing the label clears the latch and
 *   deliberately rearms the issue. The turn itself runs
 *   unattended: the auth is rewritten to the constructed
 *   autonomous principal with the intake issue number stamped in, and the
 *   approval policies deny it everything except labels, progress comments on
 *   that one issue, closing or reopening issues, and draft pull requests.
 * - Human-in-the-loop prompts are the channel's own (eve ≥ 0.34 posts them by
 *   default): when a session stops for approval or input, the channel renders
 *   the request as a comment with a mention-based reply instruction. Passing
 *   the `botName` resolver is what makes both the instruction and the reply's
 *   mention-stripping correct, and `onComment`'s gate is what keeps a reply
 *   an authorization signal: only mentions from verified repository writers
 *   ever reach the waiting session.
 */
export default githubChannel({
  botName: resolveBotName,
  credentials: githubCredentials,
  onComment: async (ctx, comment) => {
    if (!isFactoryRepository(ctx.repository)) {
      return null;
    }
    // A resolution failure means the mention can't be matched; acknowledge
    // without dispatching and let the next event retry.
    const botName = await resolveBotName().catch(() => null);
    if (botName === null) {
      return null;
    }
    return !isIgnoredComment(comment, botName) &&
      mentionPattern(botName).test(comment.body) &&
      (await isTrustedCommenter(ctx))
      ? { auth: stampTrusted(defaultGitHubAuth(ctx)) }
      : null;
  },
  onIssue: async (ctx, issue) => {
    if (!isFactoryRepository(ctx.repository)) {
      return null;
    }
    const { labels } = issue.raw as {
      labels?: ReadonlyArray<{ name?: unknown }>;
    };
    const hasFactoryLabel =
      Array.isArray(labels) && labels.some((entry) => entry?.name === FACTORY_LABEL);
    if (issue.action === "unlabeled" && !hasFactoryLabel) {
      await clearIntakeLatch(issue.issueNumber);
      return null;
    }
    if (
      issue.action !== "labeled" ||
      !hasFactoryLabel ||
      ctx.sender.type === "Bot" ||
      !(await isTrustedLabeler(ctx)) ||
      !(await claimIntakeLatch(issue.issueNumber, ctx.delivery.id))
    ) {
      return null;
    }
    return {
      auth: stampAutonomous(defaultGitHubAuth(ctx), issue.issueNumber),
      context: [FACTORY_INTAKE_TASK],
    };
  },
});
