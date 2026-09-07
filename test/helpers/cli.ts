import { runCli } from "../../src/cli.js";

interface CliCapture {
  code: number;
  stdout: string;
  stderr: string;
}

export async function captureCli(args: string[]): Promise<CliCapture> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(["node", "diff0", ...args], {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}
