import { defineTool } from "eve/tools";
import type { ApprovalContext } from "eve/tools/approval";
import { z } from "zod";
import {
  closeIssuePolicy,
  commentPolicy,
  createPullRequestPolicy,
  labelPolicy,
  shipPolicy,
  updateIssuePolicy,
  writePolicy,
} from "./approval.js";

const policies = {
  close: closeIssuePolicy,
  comment: commentPolicy,
  createPullRequest: createPullRequestPolicy,
  label: labelPolicy,
  ship: shipPolicy,
  updateIssue: updateIssuePolicy,
  write: writePolicy,
};

function runPolicy(name: keyof typeof policies, ctx: ApprovalContext) {
  return policies[name](ctx);
}

/** Each mounted tool gets its own callback; only the policy name is captured. */
export function githubApproval(name: keyof typeof policies) {
  return defineTool({
    description: "GitHub approval callback (not mounted as a tool).",
    inputSchema: z.unknown(),
    execute: (input) => input,
    approval: (ctx) => runPolicy(name, ctx),
  }).approval;
}

/** Preserve the SDK's content/patch limits with an Eve-authored durable callback. */
export const githubModelOutput = defineTool({
  description: "GitHub output formatter (not mounted as a tool).",
  inputSchema: z.unknown(),
  execute: (input) => input,
  toModelOutput: (output) => ({
    type: "json",
    value: JSON.parse(
      JSON.stringify(output, (key, value) => {
        const limit = key === "content" ? 20_000 : key === "patch" ? 4_000 : undefined;
        return limit !== undefined && typeof value === "string" && value.length > limit
          ? `${value.slice(0, limit)}\n\n[truncated: ${value.length - limit} more characters]`
          : value;
      }),
    ),
  }),
}).toModelOutput;
