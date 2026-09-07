import { EveCliAdapter, getAgentInfo } from "../adapters/eve.js";
import { readCache, writeCache } from "../collect/cache.js";
import type { AgentInfo, EveAdapter } from "../types.js";
import { getEvalHarnessChanges, getSandboxConfigChanges, inspectValidity } from "./gitdiff.js";
import { probeHostDefaultSandboxCandidate } from "./sandbox.js";
import { createWorktree, resolveRef } from "./worktree.js";

/** Execution collaborators, grouped separately from caller configuration. */
export interface HarnessDependencies {
  adapter: EveAdapter;
  createWorktree: typeof createWorktree;
  inferSandbox: typeof probeHostDefaultSandboxCandidate;
  getAgentInfo: (cwd: string) => Promise<AgentInfo | null>;
  resolveRef: typeof resolveRef;
  readCache: typeof readCache;
  writeCache: typeof writeCache;
  inspectValidity: typeof inspectValidity;
  getEvalHarnessChanges: typeof getEvalHarnessChanges;
  getSandboxConfigChanges: typeof getSandboxConfigChanges;
}
export type LegacyHarnessDependencies = Partial<HarnessDependencies>;
export interface InjectableHarness extends LegacyHarnessDependencies {
  dependencies?: Partial<HarnessDependencies>;
}
export function harnessDependencies(options: InjectableHarness): HarnessDependencies {
  const dependencies: HarnessDependencies = {
    adapter: new EveCliAdapter(),
    createWorktree,
    inferSandbox: probeHostDefaultSandboxCandidate,
    getAgentInfo,
    resolveRef,
    readCache,
    writeCache,
    inspectValidity,
    getEvalHarnessChanges,
    getSandboxConfigChanges,
  };
  // Legacy top-level seams remain supported during the preview API migration.
  for (const name of Object.keys(dependencies) as Array<keyof HarnessDependencies>) {
    Object.assign(dependencies, options[name] === undefined ? {} : { [name]: options[name] });
  }
  return { ...dependencies, ...options.dependencies };
}
