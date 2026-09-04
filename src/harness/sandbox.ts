/**
 * Host-default sandbox capability probe. Eve does not report which sandbox an
 * app actually selected, and authored agent sandbox entry points can override
 * the default. This result is therefore only a host-default candidate; it
 * must never be presented or recorded as the backend an app actually used.
 *
 * eve's chain (dist/src/public/sandbox/backends/default.js):
 *   process.env.VERCEL          -> vercel      (n/a locally -> "unknown")
 *   Docker daemon reachable     -> docker
 *   macOS arm64 / Linux w/ KVM  -> microsandbox
 *   otherwise                   -> just-bash
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { SandboxBackend } from "../types.js";

const execFileAsync = promisify(execFile);

export interface HostDefaultSandboxCandidate {
  backend: SandboxBackend;
  inferred: true;
}

/** @deprecated The probe yields a host-default candidate, not the app's selected backend. */
export type InferredSandboxBackend = HostDefaultSandboxCandidate;

let cached: Promise<HostDefaultSandboxCandidate> | undefined;

/** Cheap, cached-per-process probe of Eve's likely host default. */
export function probeHostDefaultSandboxCandidate(): Promise<HostDefaultSandboxCandidate> {
  if (cached === undefined) {
    cached = probe();
  }
  return cached;
}

/** @deprecated Use probeHostDefaultSandboxCandidate; this does not observe the app's backend. */
export const inferSandboxBackend = probeHostDefaultSandboxCandidate;

async function probe(): Promise<InferredSandboxBackend> {
  if (process.env.VERCEL) {
    // eve would pick the vercel backend; that never applies to local
    // diff0 runs, so record it as unknown rather than guessing.
    return { backend: "unknown", inferred: true };
  }
  if (await dockerDaemonReachable()) {
    return { backend: "docker", inferred: true };
  }
  if (microsandboxCapable()) {
    return { backend: "microsandbox", inferred: true };
  }
  return { backend: "just-bash", inferred: true };
}

async function dockerDaemonReachable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 2_000,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

function microsandboxCapable(): boolean {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return true;
  }
  if (process.platform === "linux") {
    // Approximation of eve's "glibc Linux + KVM" check: KVM device present.
    return existsSync("/dev/kvm");
  }
  return false;
}
