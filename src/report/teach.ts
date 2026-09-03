/**
 * Teaching error for the no-evals case (CLI exit 2). diff0 is useless
 * without an eval suite in the target repo, so instead of a bare failure the
 * user gets a complete, copy-pasteable minimal suite: one eval file plus the
 * required evals.config.ts, and a pointer to the eve docs.
 */

import type { NoEvalsError } from "../adapters/eve.js";

const EVE_EVALS_DOCS_URL = "https://eve.dev/docs/evals/overview";

/**
 * @param appPath user-facing path of the eve app (repo + --app-dir), not the
 *   throwaway worktree path the probe actually ran in.
 */
export function renderNoEvalsHelp(appPath: string, error?: NoEvalsError): string {
  const lines: string[] = [];
  lines.push(`diff0: no evals found — ${appPath} has no evals/*.eval.ts files.`);
  lines.push("");
  lines.push("diff0 compares agent BEHAVIOR by running the repo's eve eval suite on");
  lines.push("both refs, so it needs at least one eval. A minimal suite is two files:");
  lines.push("");
  lines.push("  evals/evals.config.ts");
  lines.push("");
  lines.push('    import { defineEvalConfig } from "eve/evals";');
  lines.push("    export default defineEvalConfig({});");
  lines.push("");
  lines.push("  evals/smoke.eval.ts");
  lines.push("");
  lines.push('    import { defineEval } from "eve/evals";');
  lines.push("    export default defineEval({");
  lines.push("      async test(t) {");
  lines.push('        await t.send("What was our total revenue last quarter?");');
  lines.push("        t.succeeded();");
  lines.push('        t.messageIncludes("revenue");');
  lines.push("      },");
  lines.push("    });");
  lines.push("");
  lines.push("Eval files live anywhere under evals/**/*.eval.ts; ids derive from the path");
  lines.push('(the example above becomes eval id "smoke").');
  lines.push("");
  lines.push(`Docs: ${EVE_EVALS_DOCS_URL}`);

  const runnerMessage = error?.runnerMessage.trim() ?? "";
  if (runnerMessage.length > 0) {
    lines.push("");
    lines.push(`(eve said: ${runnerMessage})`);
  }
  return `${lines.join("\n")}\n`;
}
