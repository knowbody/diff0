/**
 * Sandbox backend inference. eve selects its local sandbox backend silently
 * (no log, span, or JSON field), so diff0
 * replicates eve's probe order once per process and records the result on
 * every RunRecord, labeled `inferred`.
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

export interface InferredSandboxBackend {
  backend: SandboxBackend;
  inferred: true;
}

let cached: Promise<InferredSandboxBackend> | undefined;

/** Cheap, cached-per-process inference of eve's sandbox backend choice. */
export function inferSandboxBackend(): Promise<InferredSandboxBackend> {
  if (cached === undefined) {
    cached = probe();
  }
  return cached;
}

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
