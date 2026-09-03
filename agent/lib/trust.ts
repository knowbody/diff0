import type { SessionAuthContext } from "eve/context";

/** Current and original callers exposed by Eve to approval policies. */
export interface SessionAuthPair {
  readonly current: SessionAuthContext | null;
  readonly initiator: SessionAuthContext | null;
}

/**
 * Constructed principal for unattended factory runs (an issue labeled
 * `eve-build`).
 *
 * @remarks
 * Real GitHub actors project as numeric `github:<id>` principals, so this
 * fixed login can never collide with one. The GitHub channel stamps it at
 * dispatch; the approval policies deny it everything except labels, progress
 * comments on its own intake issue, closing or reopening issues, and draft
 * pull requests, because an unattended turn has nobody to answer an approval
 * card and would park forever.
 */
export const AUTONOMOUS_PRINCIPAL = "github:diff0-eve-factory";

/**
 * Auth attribute marking a caller the dispatching channel decided to trust.
 *
 * @remarks
 * Trust is decided once, at dispatch, on the signed webhook: the GitHub
 * channel stamps it only after GitHub verifies write, maintain, or admin
 * repository permission. Nothing downstream re-derives trust from
 * model-readable content.
 */
export const TRUSTED_ATTRIBUTE = "trusted";

/**
 * Returns a copy of `auth` carrying the {@link TRUSTED_ATTRIBUTE} stamp.
 *
 * @remarks
 * Channels call this at dispatch, next to the authorization decision itself,
 * so the stamp and the gate can never drift apart.
 */
export function stampTrusted(auth: SessionAuthContext): SessionAuthContext {
  return {
    ...auth,
    attributes: { ...auth.attributes, [TRUSTED_ATTRIBUTE]: "true" },
  };
}

/**
 * Auth attribute carrying the issue number an unattended run was dispatched
 * from.
 *
 * @remarks
 * Stamped by {@link stampAutonomous} at dispatch, on the signed webhook, so
 * the approval policies can scope an unattended run's comment writes to its
 * own intake thread. Attribute values are strings; read it back through
 * {@link intakeIssueNumber}.
 */
export const INTAKE_ISSUE_ATTRIBUTE = "intakeIssue";

/**
 * Rewrites a channel auth into the unattended factory principal, carrying the
 * intake issue number.
 *
 * @remarks
 * The GitHub channel calls this when the factory label is applied: the
 * webhook sender's identity is replaced (the turn must never run as the
 * labeler), and the issue number is stamped so `commentPolicy` can let the
 * run narrate on its own thread and nowhere else.
 */
export function stampAutonomous(auth: SessionAuthContext, intakeIssue: number): SessionAuthContext {
  const attributes = { ...auth.attributes };
  delete attributes[TRUSTED_ATTRIBUTE];
  return {
    ...auth,
    attributes: {
      ...attributes,
      [INTAKE_ISSUE_ATTRIBUTE]: String(intakeIssue),
    },
    principalId: AUTONOMOUS_PRINCIPAL,
    principalType: "service",
  };
}

/**
 * The issue number an unattended run was dispatched from, or null when the
 * session is not an unattended run (or predates the stamp).
 */
export function intakeIssueNumber(auth: SessionAuthContext | null): number | null {
  if (!isAutonomous(auth)) {
    return null;
  }
  const stamped = auth?.attributes[INTAKE_ISSUE_ATTRIBUTE];
  if (typeof stamped !== "string" || stamped === "") {
    return null;
  }
  const issue = Number(stamped);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

/**
 * Whether the session runs unattended under {@link AUTONOMOUS_PRINCIPAL}.
 */
export function isAutonomous(auth: SessionAuthContext | null): boolean {
  return auth !== null && auth.principalId === AUTONOMOUS_PRINCIPAL;
}

/**
 * Whether the dispatching channel stamped this caller as trusted.
 *
 * @remarks
 * This is the single caller check for routine repository writes. New
 * capabilities gate on this predicate (or {@link isAutonomous}) rather than
 * inventing their own.
 */
export function isTrusted(auth: SessionAuthContext | null): boolean {
  return auth !== null && auth.attributes[TRUSTED_ATTRIBUTE] === "true";
}

/**
 * An unattended session stays unattended on later turns. Checking both values
 * prevents a human follow-up from silently replacing the restricted service
 * principal that originally created the session.
 */
export function isAutonomousSession(auth: SessionAuthPair): boolean {
  return isAutonomous(auth.current) || isAutonomous(auth.initiator);
}

/**
 * Routine writes run without approval only when both the current caller and
 * the session initiator are trusted. A trusted maintainer can therefore not
 * turn a session created by an untrusted actor into an implicitly trusted one.
 */
export function isTrustedSession(auth: SessionAuthPair): boolean {
  return isTrusted(auth.current) && (auth.initiator === null || isTrusted(auth.initiator));
}
