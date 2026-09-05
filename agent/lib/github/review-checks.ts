import type { SandboxSession } from "eve/sandbox";
import { sanitizeCommandOutput } from "./bootstrap-diagnostics.js";
import { REPO_DIR } from "./git-remote.js";
import { BASE_MARKER_PATH } from "./runtime-push.js";

/** App-owned commands: a model cannot replace a required check with an assertion. */
export async function runReviewChecks(sandbox: SandboxSession): Promise<string[]> {
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
  const passed: string[] = [];
  for (const command of checks) {
    const result = await sandbox.run({
      command: `cd ${REPO_DIR} && timeout 600 sh -c '${command.replaceAll("'", "'\\''")}'`,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        sanitizeCommandOutput(
          `Required review check failed (exit ${result.exitCode}): ${command}\n${String(result.stderr || result.stdout).slice(-2500)}`,
        ),
      );
    }
    passed.push(command);
  }
  return passed;
}
