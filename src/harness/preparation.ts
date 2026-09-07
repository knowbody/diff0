import { join } from "node:path";
import { computeCacheKey } from "../collect/cache.js";
import type { AgentInfo, DependencyInstallMode, SandboxBackend } from "../types.js";
import { cleanupResources } from "./cleanup.js";
import type { HarnessDependencies } from "./dependencies.js";
import type { WorktreeHandle } from "./worktree.js";

interface PreparationOptions {
  repoPath: string;
  appDir: string;
  evalFilter: string[];
  installMode?: DependencyInstallMode;
  timeoutMs?: number;
  maxConcurrency?: number;
}
export interface PreparedApp {
  ref: string;
  commitSha: string;
  cwd: string;
  worktree: WorktreeHandle;
  probe: Awaited<ReturnType<HarnessDependencies["adapter"]["probe"]>>;
  agentInfo: AgentInfo | null;
}
/** Own cleanup from the moment a checkout exists, including failed probe/identity checks. */
export async function prepareApp(
  options: PreparationOptions,
  ref: string,
  commitSha: string,
  dependencies: HarnessDependencies,
  progress: ((message: string) => void) | undefined,
): Promise<PreparedApp> {
  const worktree = await dependencies.createWorktree(options.repoPath, ref, {
    installDirs: options.appDir === "." ? [] : [options.appDir],
    installMode: options.installMode ?? "scripts-off",
    resolvedCommitSha: commitSha,
  });
  try {
    if (worktree.commitSha !== commitSha)
      throw new Error(
        `worktree commit mismatch: resolved ${commitSha}, checked out ${worktree.commitSha}`,
      );
    const cwd = join(worktree.path, options.appDir);
    const probe = await dependencies.adapter.probe(cwd);
    const agentInfo =
      probe.agentInfo !== undefined ? probe.agentInfo : await dependencies.getAgentInfo(cwd);
    return { ref, commitSha, cwd, worktree, probe, agentInfo };
  } catch (error) {
    await cleanupResources([worktree], progress);
    throw error;
  }
}
export function appCacheKey(
  options: PreparationOptions,
  app: PreparedApp,
  commitSha: string,
  sandboxBackend: SandboxBackend,
): string {
  return computeCacheKey({
    appDir: options.appDir,
    commitSha,
    eveVersion: app.probe.eveVersion,
    model: app.agentInfo?.model ?? "unknown",
    evalFilter: options.evalFilter,
    sandboxBackend,
    installMode: options.installMode ?? "scripts-off",
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
  });
}
