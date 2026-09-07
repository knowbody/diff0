import type { CreateWorktreeOptions, WorktreeHandle } from "../../src/harness/worktree.js";
import { buildRun, type RunSpec } from "./records.js";

/** Minimal suite record; scenario-specific overrides stay visible at the call site. */
export function harnessRecord(
  ref: string,
  commitSha: string,
  runIndex: number,
  overrides: RunSpec = {},
) {
  return buildRun(ref, commitSha, runIndex, {
    evals: { "e/one": { passed: true, checks: [{ name: "c", passed: true }] } },
    tokens: { input: 10, output: 5 },
    costUsd: null,
    durationMs: 1500,
    model: "fake/unpriced-model",
    eveVersion: "0.29.5-fake",
    ...overrides,
  });
}
export function fakeWorktrees(sha: string) {
  const created: string[] = [];
  const cleanups: string[] = [];
  const options: Array<CreateWorktreeOptions | undefined> = [];
  return {
    created,
    cleanups,
    options,
    factory: async (
      _repoPath: string,
      ref: string,
      opts?: CreateWorktreeOptions,
    ): Promise<WorktreeHandle> => {
      created.push(ref);
      options.push(opts);
      return {
        path: `/fake-worktree/${ref}`,
        commitSha: sha,
        cleanup: async () => {
          cleanups.push(ref);
        },
      };
    },
  };
}
