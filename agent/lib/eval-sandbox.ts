import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

export const connectorFreeEval = process.env.FACTORY_EVAL_SANDBOX === "justbash";
if (connectorFreeEval && process.env.VERCEL === "1") {
  throw new Error("FACTORY_EVAL_SANDBOX must not be enabled on a Vercel deployment.");
}

/** Do not prewarm or clone live repositories for the connector-free suite. */
export function unavailableStationSandbox() {
  return defineSandbox({
    backend: justbash(),
    onSession() {
      throw new Error("Repository stations require a connected run without FACTORY_EVAL_SANDBOX.");
    },
  });
}
