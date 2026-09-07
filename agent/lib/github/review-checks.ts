import { defineState } from "eve/context";
import type { SandboxSession } from "eve/sandbox";
import { verificationPlan } from "../verification.js";
import { sanitizeCommandOutput } from "./bootstrap-diagnostics.js";
import { REPO_DIR } from "./git-remote.js";
import type { ReviewTarget } from "./review-target.js";

export type ReviewSandbox = Pick<SandboxSession, "run">;

export interface ReviewChecks {
  branch: string;
  sha: string;
  baseSha: string;
  passed: string[];
}

export const reviewChecks = defineState<ReviewChecks | null>("diff0.review-checks.v3", () => null);

/** App-owned commands: a model cannot replace a required check with an assertion. */
export function reviewCheckPlan(target: ReviewTarget | null) {
  if (!target || !/^[a-f0-9]{40}$/.test(target.baseSha) || !/^[a-f0-9]{40}$/.test(target.sha)) {
    throw new Error("Review requires a trusted checkout target. Call checkout_branch first.");
  }
  return {
    baseSha: target.baseSha,
    checks: verificationPlan(target.paths, target.baseSha).map(({ command }) => command),
  };
}

export async function reviewedSha(sandbox: ReviewSandbox, branch: string): Promise<string> {
  const status = await sandbox.run({ command: `git -C ${REPO_DIR} status --porcelain` });
  const head = await sandbox.run({
    command: `git -C ${REPO_DIR} branch --show-current && git -C ${REPO_DIR} rev-parse HEAD`,
  });
  const [actualBranch, sha] = String(head.stdout).trim().split("\n");
  if (
    status.exitCode !== 0 ||
    String(status.stdout).trim() !== "" ||
    head.exitCode !== 0 ||
    actualBranch !== branch ||
    !/^[a-f0-9]{40}$/.test(sha ?? "")
  ) {
    throw new Error("Review checks require a clean checkout of the requested branch.");
  }
  return sha;
}

/** One bounded command per tool call, so each result reaches a durable step boundary. */
export async function runNextReviewCheck(
  sandbox: ReviewSandbox,
  branch: string,
  current: ReviewChecks | null,
  target: ReviewTarget | null,
): Promise<ReviewChecks> {
  const plan = reviewCheckPlan(target);
  const sha = await reviewedSha(sandbox, branch);
  if (target?.branch !== branch || target.sha !== sha)
    throw new Error("The review target changed. Call checkout_branch again before checking.");
  const matches =
    current?.branch === branch &&
    current.sha === sha &&
    current.baseSha === plan.baseSha &&
    current.passed.every((command, index) => command === plan.checks[index]);
  const passed = matches ? [...current.passed] : [];
  const command = plan.checks[passed.length];
  if (command) {
    const result = await sandbox.run({
      command: `cd ${REPO_DIR} && timeout -k 5 240 sh -c '${command.replaceAll("'", "'\\''")}'`,
    });
    if (result.exitCode !== 0)
      throw new Error(
        sanitizeCommandOutput(
          `Required review check failed (exit ${result.exitCode}): ${command}\n${String(result.stderr || result.stdout).slice(-2500)}`,
        ),
      );
    if ((await reviewedSha(sandbox, branch)) !== sha)
      throw new Error("The reviewer checkout changed during verification.");
    passed.push(command);
  }
  return { branch, sha, baseSha: plan.baseSha, passed };
}

export function requireReviewChecks(
  current: ReviewChecks | null,
  branch: string,
  sha: string,
  plan: { baseSha: string; checks: string[] },
): string[] {
  if (
    !current ||
    current.branch !== branch ||
    current.sha !== sha ||
    current.baseSha !== plan.baseSha ||
    current.passed.length !== plan.checks.length ||
    !plan.checks.every((command, index) => current.passed[index] === command)
  ) {
    throw new Error(
      "Required checks are incomplete for this commit. Call check_review sequentially until complete before attesting.",
    );
  }
  return current.passed;
}
