import type { MessageStreamEvent } from "eve/client";

import { MOUNTED_GITHUB_WRITES, ROOT_WRITE_TOOLS } from "../agent/lib/github/capabilities.js";

/** Derived from the mounted extension inventory and the SDK's write classification. */
export const GITHUB_WRITE_TOOLS = MOUNTED_GITHUB_WRITES.map((name) => `github__${name}` as const);
export { ROOT_WRITE_TOOLS };
export const WRITE_TOOLS = [...GITHUB_WRITE_TOOLS, ...ROOT_WRITE_TOOLS] as const;

/**
 * The four factory stations, in pipeline order.
 */
export const STATIONS = ["classifier", "analyst", "implementer", "reviewer"] as const;

/** Refuse destructive evals unless they explicitly target a disposable repository. */
export function requireMutatingEvalRepository(): void {
  const target = process.env.FACTORY_REPO?.trim();
  const scratch = process.env.MUTATING_EVAL_REPO?.trim();
  if (process.env.ALLOW_MUTATING_EVALS !== "1") {
    throw new Error("Mutating eval refused. Set ALLOW_MUTATING_EVALS=1 for a deliberate run.");
  }
  if (!scratch || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(scratch)) {
    throw new Error("Mutating eval refused. Set MUTATING_EVAL_REPO to a disposable owner/repo.");
  }
  if (scratch.toLowerCase() === "knowbody/diff0") {
    throw new Error("Mutating evals must never target knowbody/diff0.");
  }
  if (target !== scratch) {
    throw new Error("Mutating eval refused. FACTORY_REPO must exactly match MUTATING_EVAL_REPO.");
  }
}

/**
 * Returns the order in which subagents were first delegated to during a run,
 * extracted from `subagent.called` stream events.
 *
 * @remarks
 * Station delegations are subagent calls, not tool calls, so ordering
 * assertions walk the subagent events rather than `t.toolOrder`.
 */
export function subagentCallOrder(events: readonly MessageStreamEvent[]): string[] {
  const order: string[] = [];
  for (const event of events) {
    if (event.type !== "subagent.called") {
      continue;
    }
    const { name } = event.data as { name?: unknown };
    if (typeof name === "string" && !order.includes(name)) {
      order.push(name);
    }
  }
  return order;
}

/**
 * True when every named subagent was called and their first calls happened in
 * the given order (other calls may interleave).
 */
export function calledInOrder(
  events: readonly MessageStreamEvent[],
  names: readonly string[],
): boolean {
  const order = subagentCallOrder(events);
  const indices = names.map((name) => order.indexOf(name));
  return indices.every((index, i) => index !== -1 && (i === 0 || index > (indices[i - 1] ?? -1)));
}
