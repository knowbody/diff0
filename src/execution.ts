import { spawn } from "node:child_process";
import { CommandTimeoutError, ConfigurationError } from "./errors.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Parent cancellation forwarded to the detached command process group. */
export class CommandInterruptedError extends Error {
  readonly signal: "SIGINT" | "SIGTERM";

  constructor(bin: string, args: string[], signal: "SIGINT" | "SIGTERM") {
    super(`${bin} ${args.join(" ")} interrupted by ${signal}`);
    this.name = "CommandInterruptedError";
    this.signal = signal;
  }
}

const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const TERMINATION_GRACE_MS = 2_000;

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function signalProcessTree(childPid: number | undefined, signal: NodeJS.Signals): void {
  if (childPid === undefined) return;
  try {
    if (process.platform === "win32") {
      // Node cannot signal a Windows process group. The direct child still
      // receives the signal; CI's supported Linux/macOS runners get the full
      // process-group behavior below.
      process.kill(childPid, signal);
    } else {
      process.kill(-childPid, signal);
    }
  } catch {
    // ESRCH means the process already exited. `close` remains the single
    // settlement point, so racing exit/timeout cannot double-settle.
  }
}

export function runCommand(
  bin: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 2_147_483_647)
  ) {
    return Promise.reject(
      new ConfigurationError("command timeoutMs must be an integer between 1 and 2147483647"),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminalError: Error | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const terminate = (error: Error): void => {
      if (terminalError !== undefined) return;
      terminalError = error;
      signalProcessTree(child.pid, "SIGTERM");
      killTimer = setTimeout(() => signalProcessTree(child.pid, "SIGKILL"), TERMINATION_GRACE_MS);
      killTimer.unref();
    };
    const capture = (target: "stdout" | "stderr", chunk: string): void => {
      if (terminalError !== undefined) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maxOutputBytes) {
        terminate(
          new Error(
            `${bin} ${args.join(" ")} exceeded the ${maxOutputBytes}-byte combined output limit`,
          ),
        );
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    const onSigint = (): void => {
      terminate(new CommandInterruptedError(bin, args, "SIGINT"));
    };
    const onSigterm = (): void => {
      terminate(new CommandInterruptedError(bin, args, "SIGTERM"));
    };

    // The child owns a detached process group on Unix so timeout and cancellation
    // can terminate every descendant. Forward parent cancellation explicitly;
    // otherwise Ctrl-C would only terminate diff0 and leave the paid eval alive.
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const timeoutMs = options.timeoutMs;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        terminate(new CommandTimeoutError(bin, args, timeoutMs));
      }, timeoutMs);
      timer.unref();
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      capture("stdout", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      capture("stderr", chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (terminalError !== undefined) {
        // The direct child may exit before one of its descendants. Kill the
        // detached group once more before clearing the grace timer.
        signalProcessTree(child.pid, "SIGKILL");
        cleanup();
        reject(terminalError);
        return;
      }
      cleanup();
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
