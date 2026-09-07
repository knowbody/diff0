import { appendFileSync, readFileSync } from "node:fs";
import { enforceActionReport, executionFailure, validateActionInputs } from "./action-policy.js";

// Prevent model-controlled report text or Action inputs from injecting workflow commands.
const annotationText = (text: string) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

try {
  const mode = process.argv[2];
  if (mode === "preflight") {
    validateActionInputs(process.env);
  } else if (mode === "enforce") {
    const failure = executionFailure(process.env.CLI_EXIT);
    const result =
      failure ??
      enforceActionReport(
        JSON.parse(readFileSync(process.env.REPORT_JSON ?? "", "utf8")),
        process.env.FAIL_ON ?? "regression",
      );
    if (result.verdict && process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${result.verdict}\n`);
    }
    process.stdout.write(
      `${result.code ? "::error::" : ""}diff0: ${annotationText(result.message)}\n`,
    );
    process.exitCode = result.code;
  } else {
    throw new Error("expected preflight or enforce");
  }
} catch (error) {
  process.stdout.write(
    `::error::diff0: invalid Action input or report: ${annotationText(errorText(error))}\n`,
  );
  process.exitCode = process.argv[2] === "preflight" ? 2 : 3;
}
