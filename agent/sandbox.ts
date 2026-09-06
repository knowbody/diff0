import { defineSandbox, type SandboxSessionContext } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";
import { vercel } from "eve/sandbox/vercel";
import { connectorFreeEval } from "./lib/eval-sandbox.js";
import { FACTORY_SANDBOX_CREATE_OPTIONS } from "./lib/github/repo-sandbox.js";

// Connector-free comparisons only need the seeded skill files, not a hosted VM.
// Keep the production factory and all implementation/review stations on Vercel.

/**
 * Root agent sandbox configuration.
 *
 * @remarks
 * Uses hosted Vercel Sandbox for development and production. Connector-free comparisons can
 * explicitly use just-bash for root skill-file reads. Ordinary local development requires the
 * project to be linked and authenticated to Vercel.
 *
 * The `onSession` hook marks `/workspace` as a safe git directory before the GitHub channel's
 * built-in per-turn checkout runs there. The sandbox filesystem is owned by the builder uid,
 * not the session user, so without this git aborts every command with "detected dubious
 * ownership in repository at '/workspace'", the channel swallows the failed checkout, and the
 * turn runs with no working tree. The station sandboxes handle the same hazard for
 * `/workspace/repo` in `agent/lib/github/repo-sandbox.ts`.
 *
 * @see {@link https://vercel.com/docs/sandbox | Vercel Sandbox}
 */
export default defineSandbox({
  backend: connectorFreeEval ? justbash() : vercel(FACTORY_SANDBOX_CREATE_OPTIONS),
  async onSession({ use }: SandboxSessionContext): Promise<void> {
    if (connectorFreeEval) return;
    const sandbox = await use();
    const result = await sandbox.run({
      command: "git config --global --add safe.directory /workspace",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to mark /workspace as a safe git directory (exit ${result.exitCode}): ${String(
          result.stderr || result.stdout,
        ).trim()}`,
      );
    }
  },
});
