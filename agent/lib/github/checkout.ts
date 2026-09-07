import type { SandboxSession } from "eve/sandbox";
import { sanitizeCommandOutput } from "./bootstrap-diagnostics.js";
import { githubCredentials } from "./credentials.js";
import {
  brokerPolicy,
  fetchFactoryRepositoryMetadata,
  mintInstallationToken,
  REMOTE_URL,
  REPO_DIR,
  validateBranch,
} from "./git-remote.js";
import { isOwnedBranch } from "./runtime-push.js";

export type CheckoutSandbox = Pick<SandboxSession, "run" | "setNetworkPolicy">;

/** Fetch only a session-owned branch with a read credential, then restore denied egress. */
export async function checkoutOwnedBranch(
  sandbox: CheckoutSandbox,
  branch: string,
  rootSessionId: string,
): Promise<{ branch: string; sha: string }> {
  if (!isOwnedBranch(branch, rootSessionId))
    throw new Error("That branch is not owned by this agent session.");
  const token = await mintInstallationToken(githubCredentials);
  const { defaultBranch } = await fetchFactoryRepositoryMetadata(token);
  const refusal = validateBranch(branch, defaultBranch);
  if (refusal) throw new Error(refusal);
  try {
    await sandbox.setNetworkPolicy(brokerPolicy(token));
    const result = await sandbox.run({
      command: `git -C ${REPO_DIR} fetch ${REMOTE_URL} '${branch}' && git -C ${REPO_DIR} checkout -B '${branch}' FETCH_HEAD`,
    });
    if (result.exitCode !== 0)
      throw new Error(
        sanitizeCommandOutput(
          `git fetch/checkout exited ${result.exitCode}: ${String(result.stderr || result.stdout).trim()}`,
        ),
      );
    const head = await sandbox.run({ command: `git -C ${REPO_DIR} rev-parse HEAD` });
    const sha = String(head.stdout).trim();
    if (head.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error("Could not resolve the fetched branch head.");
    return { branch, sha };
  } finally {
    await sandbox.setNetworkPolicy("deny-all");
  }
}
