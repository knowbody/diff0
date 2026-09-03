import { runCli } from "../src/cli.js";

runCli(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`diff0: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  });
