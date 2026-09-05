import { defineState } from "eve/context";
import type { SandboxSession } from "eve/sandbox";
import { sanitizeCommandOutput } from "./bootstrap-diagnostics.js";
import { REPO_DIR } from "./git-remote.js";
import { BASE_MARKER_PATH } from "./runtime-push.js";

export interface ReviewChecks {
  branch: string;
  sha: string;
  baseSha: string;
  passed: string[];
}

export const reviewChecks = defineState<ReviewChecks | null>("diff0.review-checks.v2", () => null);

/** App-owned commands: a model cannot replace a required check with an assertion. */
export async function reviewCheckPlan(sandbox: SandboxSession) {
  const marker = JSON.parse((await sandbox.readTextFile({ path: BASE_MARKER_PATH })) ?? "null");
  if (!marker || typeof marker.sha !== "string" || !/^[a-f0-9]{40}$/.test(marker.sha)) {
    throw new Error("Review checks require a valid checkout base SHA.");
  }
  const checks = [
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "pnpm test:integration",
    "pnpm build",
  ];
  const changed = await sandbox.run({
    command: `git -C ${REPO_DIR} diff --name-only '${marker.sha}' HEAD`,
  });
  if (changed.exitCode !== 0)
    throw new Error("Cannot determine the scope of required review checks.");
  const engineChanged = String(changed.stdout)
    .split("\n")
    .some((path) => /^(src\/|action\/|prices\.json$|package\.json$|pnpm-lock\.yaml$)/.test(path));
  if (engineChanged) {
    checks.push(
      "pnpm action:build && git diff --exit-code -- action/dist/cli.mjs",
      `DIFF0_DEMO_MODEL=mock node dist/cli.js run --repo . --app-dir fixtures/demo-agent --base '${marker.sha}' --head HEAD --runs 3 --fail-on drift`,
    );
  }
  return { baseSha: marker.sha as string, checks };
}

export async function reviewedSha(sandbox: SandboxSession, branch: string): Promise<string> {
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
  sandbox: SandboxSession,
  branch: string,
  current: ReviewChecks | null,
): Promise<ReviewChecks> {
  const sha = await reviewedSha(sandbox, branch);
  const plan = await reviewCheckPlan(sandbox);
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
