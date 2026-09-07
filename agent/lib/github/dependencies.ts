import type { SandboxSession } from "eve/sandbox";
import { sanitizeCommandOutput } from "./bootstrap-diagnostics.js";
import { REPO_DIR } from "./git-remote.js";

/** Reconcile the checkout with the template's cached packages, without enabling egress. */
export async function syncFactoryDependencies(sandbox: Pick<SandboxSession, "run">): Promise<void> {
  const result = await sandbox.run({
    command: `cd ${REPO_DIR} && timeout -k 5 180 sh -c 'pnpm install --offline --frozen-lockfile --ignore-scripts && if [ -f fixtures/demo-agent/pnpm-lock.yaml ]; then pnpm --dir fixtures/demo-agent install --offline --frozen-lockfile --ignore-scripts; fi'`,
  });
  if (result.exitCode !== 0)
    throw new Error(
      sanitizeCommandOutput(
        `The snapshot cannot satisfy this checkout's locked dependencies offline (exit ${result.exitCode}). Bump FACTORY_BOOTSTRAP_REVISION and rebuild the deployment to refresh its dependency cache. No station may proceed with stale dependencies. ${String(result.stderr || result.stdout).slice(-2000)}`,
      ),
    );
}
