import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import {
  intakeIssueNumber,
  isAutonomousSession,
  isTrustedSession,
  type SessionAuthPair,
} from "../trust.js";
import { getGitHubRef } from "./api.js";
import { githubCredentials } from "./credentials.js";
import {
  type DraftPullRequestInput,
  fetchFactoryRepositoryMetadata,
  mintInstallationToken,
  validateDraftPullRequest,
} from "./git-remote.js";
import { readReviewAttestation } from "./review-attestation.js";
import { isOwnedBranch } from "./runtime-push.js";

type IssueTargetInput = { issueNumber?: unknown } | undefined;

/** Both records must exist and name the same immutable commit. */
export function isReviewedRemoteCommit(
  attestedSha: string | null,
  remoteSha: string | null,
): boolean {
  return attestedSha !== null && remoteSha !== null && attestedSha === remoteSha;
}

function autonomousIssueTargetPolicy(
  auth: SessionAuthPair,
  input: IssueTargetInput,
  action: string,
): ApprovalStatus {
  const intakeIssue = intakeIssueNumber(auth.initiator) ?? intakeIssueNumber(auth.current);
  if (intakeIssue !== null && input?.issueNumber === intakeIssue) {
    return "not-applicable";
  }
  return {
    reason: `Unattended factory runs may ${action} only on the issue they were dispatched from${
      intakeIssue === null ? "" : ` (#${intakeIssue})`
    }.`,
    type: "denied",
  };
}

/**
 * Baseline policy for reversible repository writes (comments, issue creation,
 * assignees, reviewer requests, stateless issue updates).
 *
 * @remarks
 * Unattended factory runs are denied outright rather than parked: nobody is
 * watching an autonomous turn, so an approval card would strand the session
 * forever, and a denial resolves server-side in one step. Trusted callers
 * (stamped at dispatch) run without a card because these writes are reversible
 * and low blast radius. Everyone else, the local
 * dev TUI included, parks on a card, which is also how the approval flow
 * stays demoable.
 */
export function writePolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth;
  if (isAutonomousSession(auth)) {
    return {
      reason:
        "Unattended factory runs may only apply labels, comment on their intake issue, and open draft pull requests.",
      type: "denied",
    };
  }
  if (isTrustedSession(auth)) {
    return "not-applicable";
  }
  return "user-approval";
}

/**
 * `addIssueComment`: an unattended run may narrate on the issue it was
 * dispatched from, and nowhere else.
 *
 * @remarks
 * A progress comment is as reversible and low blast radius as the label
 * writes {@link labelPolicy} already allows, so denying it bought no safety,
 * only a silent-until-done run. The scope is the containment: the intake
 * issue number is stamped into the session auth at dispatch (on the signed
 * webhook, never from model input), and only a comment targeting that number
 * runs, so instructions injected through the issue body cannot make the run
 * comment anywhere else in the repository. Attended callers follow
 * {@link writePolicy} unchanged.
 */
export function commentPolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth;
  if (!isAutonomousSession(auth)) {
    return writePolicy(ctx);
  }
  return autonomousIssueTargetPolicy(auth, ctx.toolInput as IssueTargetInput, "comment");
}

/**
 * The shared factory brain: durable notes about the target repository that
 * feed into every future run.
 *
 * @remarks
 * Reads are always allowed and never routed here; this policy gates writes
 * only. Because a brain entry becomes context for every later run, an
 * unattended run is denied writes rather than parked (nobody is watching, and
 * a labeled issue's body is untrusted input that must not be able to poison
 * the shared brain). Trusted callers write without a card; every other human
 * caller, the dev TUI included, parks on one.
 */
export function factoryBrainPolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth;
  if (isAutonomousSession(auth)) {
    return {
      reason: "Unattended factory runs may read the factory brain but not write to it.",
      type: "denied",
    };
  }
  if (isTrustedSession(auth)) {
    return "not-applicable";
  }
  return "user-approval";
}

/**
 * Label writes: the one reversible write an unattended run also needs, so it
 * can mark the work item as picked up.
 */
export function labelPolicy(ctx: ApprovalContext): ApprovalStatus {
  return isAutonomousSession(ctx.session.auth)
    ? autonomousIssueTargetPolicy(
        ctx.session.auth,
        ctx.toolInput as IssueTargetInput,
        "change labels",
      )
    : writePolicy(ctx);
}

/**
 * Policy for shipping work: marking a pull request ready for review.
 *
 * @remarks
 * This parks for every human caller, trusted or not; shipping is the factory's
 * human gate. Unattended runs are denied outright.
 */
export function shipPolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isAutonomousSession(ctx.session.auth)) {
    return {
      reason: "Unattended factory runs stop at a draft pull request; a person marks it ready.",
      type: "denied",
    };
  }
  return "user-approval";
}

/**
 * Closing and reopening issues: routine, reversible triage for attended
 * callers. Unattended runs remain scoped to their stamped intake issue.
 *
 * @remarks
 * Closing a duplicate or stale issue is everyday triage, and a reopen undoes
 * it, so attended callers use the baseline write policy rather than a shipping
 * gate. Unattended issue-label runs can only update the issue that was stamped
 * into their session at dispatch.
 */
export function closeIssuePolicy(ctx: ApprovalContext): ApprovalStatus {
  return isAutonomousSession(ctx.session.auth)
    ? autonomousIssueTargetPolicy(ctx.session.auth, ctx.toolInput as IssueTargetInput, "close")
    : writePolicy(ctx);
}

/**
 * `createPullRequest`: a draft runs for every caller, anything that can be
 * merged follows {@link shipPolicy}.
 *
 * @remarks
 * A draft cannot merge, so an unattended run can deliver its finished work
 * without a card while marking the PR ready stays a human act.
 */
export async function createPullRequestPolicy(ctx: ApprovalContext): Promise<ApprovalStatus> {
  const input = ctx.toolInput as DraftPullRequestInput | undefined;
  if (input?.draft !== true) {
    return shipPolicy(ctx);
  }
  try {
    const token = await mintInstallationToken(githubCredentials);
    const { defaultBranch } = await fetchFactoryRepositoryMetadata(token);
    const refusal = validateDraftPullRequest(input, defaultBranch);
    const branch = typeof input?.head === "string" ? input.head : null;
    const attestation =
      branch === null ? null : await readReviewAttestation(ctx.session.id, branch);
    const remote = branch === null ? null : await getGitHubRef(`heads/${branch}`, { token });
    if (
      refusal === null &&
      branch !== null &&
      isOwnedBranch(branch, ctx.session.id) &&
      isReviewedRemoteCommit(attestation?.sha ?? null, remote?.object.sha ?? null)
    ) {
      return "not-applicable";
    }
    return isAutonomousSession(ctx.session.auth)
      ? {
          reason: refusal ?? "The pull request branch is not owned by this agent session.",
          type: "denied",
        }
      : "user-approval";
  } catch {
    return isAutonomousSession(ctx.session.auth)
      ? {
          reason: "The factory could not verify the pull request branch and base.",
          type: "denied",
        }
      : "user-approval";
  }
}

/**
 * `updateIssue`: setting `state` closes or reopens the issue, so those calls
 * follow {@link closeIssuePolicy}; stateless updates follow
 * {@link writePolicy}.
 *
 * @remarks
 * The split keeps the two paths honest: a close or reopen through
 * `updateIssue` is the same reversible triage as `closeIssue` and runs the
 * same way, while a stateless edit (title, body, labels) stays under the
 * baseline write policy.
 */
export function updateIssuePolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isAutonomousSession(ctx.session.auth)) {
    const targetStatus = autonomousIssueTargetPolicy(
      ctx.session.auth,
      ctx.toolInput as IssueTargetInput,
      "update",
    );
    if (targetStatus !== "not-applicable") return targetStatus;
    const input = ctx.toolInput as Record<string, unknown> | undefined;
    const allowed = new Set(["issueNumber", "state", "stateReason", "labels"]);
    const forbidden = Object.keys(input ?? {}).filter((key) => !allowed.has(key));
    return forbidden.length === 0
      ? "not-applicable"
      : {
          reason: `Unattended factory runs may not change issue fields: ${forbidden.join(", ")}.`,
          type: "denied",
        };
  }
  const input = ctx.toolInput as { state?: unknown } | undefined;
  if (input?.state !== undefined) {
    return closeIssuePolicy(ctx);
  }
  return writePolicy(ctx);
}
