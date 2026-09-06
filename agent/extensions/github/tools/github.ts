import { connectGithubToken } from "@github-tools/sdk/connect";
import {
  executeGithubEveTool,
  type GithubToolName,
  listEveToolDescriptors,
  resolveEveToolApproval,
} from "@github-tools/sdk/eve-runtime";
import { defineDynamic, defineTool } from "eve/tools";
import { githubOptions } from "../extension.js";

// Read app-owned configuration directly. The package's ambient config namespace
// can diverge from the consumer mount after pnpm changes its dependency layout.
function sessionOptions() {
  return {
    ...githubOptions,
    token: connectGithubToken(githubOptions.connector, { include: githubOptions.include }),
  };
}

function execute(name: GithubToolName, input: unknown) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("GitHub tool input must be an object.");
  }
  return executeGithubEveTool(name, input as Record<string, unknown>, sessionOptions());
}

export default defineDynamic({
  events: {
    "step.started": () => {
      const options = sessionOptions();
      return Object.fromEntries(
        listEveToolDescriptors(options).map((entry) => {
          const name = entry.name;
          const overrides = options.overrides as Record<
            string,
            { toModelOutput?: typeof options.overrides.getFileContent.toModelOutput }
          >;
          const approval = entry.writeTool
            ? resolveEveToolApproval(entry.writeTool, options.requireApproval)
            : undefined;
          return [
            `github__${name}`,
            defineTool({
              description: entry.description,
              inputSchema: entry.inputSchema,
              ...(approval ? { approval } : {}),
              ...(overrides[name]?.toModelOutput
                ? { toModelOutput: overrides[name]?.toModelOutput }
                : {}),
              execute: (input) => execute(name, input),
            }),
          ];
        }),
      );
    },
  },
});
