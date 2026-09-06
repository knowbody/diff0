/** Paid, controlled model pilot; local tool substitutes, no production publication. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createGateway, generateText, jsonSchema, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import analyst from "../agent/subagents/analyst/agent.js";
import implementer from "../agent/subagents/implementer/agent.js";
import researcher from "../agent/subagents/researcher/agent.js";

const { values } = parseArgs({
  options: {
    role: { type: "string" },
    variant: { type: "string" },
    "max-output-tokens": { type: "string", default: "2048" },
    "report-dir": { type: "string", default: ".eve/luna-trial" },
  },
});
const maxOutputTokens = Number(values["max-output-tokens"]);
if (
  (values.role && !["analyst", "implementer", "researcher"].includes(values.role)) ||
  (values.variant && !["baseline", "candidate"].includes(values.variant)) ||
  !Number.isInteger(maxOutputTokens) ||
  maxOutputTokens < 128 ||
  maxOutputTokens > 4096
)
  throw Error("Invalid role, variant, or output-token limit (128–4096).");
const key = process.env.AI_GATEWAY_API_KEY;
mkdirSync(values["report-dir"], { recursive: true });
if (!key) throw Error("Missing gateway key");
const gateway = createGateway({ apiKey: key });
const baseModels = {
  analyst: "openai/gpt-5.4-mini",
  implementer: "anthropic/claude-sonnet-5",
  researcher: "openai/gpt-5.4-mini",
};
const configs = { analyst, implementer, researcher };
const initial = "# Example project\n\nA tiny project used for a controlled model trial.\n";
const sources = {
  "https://developers.openai.com/api/docs/models/gpt-5.6-luna":
    "Official model documentation snapshot, 2026-09-06: GPT-5.6 Luna supports xhigh reasoning. Standard short-context prices per million tokens: input $0.20, cached input $0.02, output $1.20. Larger reasoning budgets may consume more tokens.",
  "https://developers.openai.com/api/docs/models/gpt-5.4-mini":
    "Official model documentation snapshot, 2026-09-06: GPT-5.4 Mini standard prices per million tokens: input $0.75, cached input $0.075, output $4.50.",
};
const records = [];
let spent = 0,
  unknownCost = false;
const save = () =>
  writeFileSync(
    join(values["report-dir"], "results.json"),
    JSON.stringify(
      {
        kind: "controlled-station-model-pilot",
        limitUsd: 1,
        maxOutputTokens,
        totalCostUsd: spent,
        unknownCost,
        records,
      },
      null,
      2,
    ),
  );
for (const role of ["analyst", "implementer", "researcher"]) {
  if (values.role && role !== values.role) continue;
  for (const variant of role === "implementer"
    ? ["candidate", "baseline"]
    : ["baseline", "candidate"]) {
    if (values.variant && variant !== values.variant) continue;
    if (unknownCost || spent >= 0.75)
      throw Error("Stopping before further spend: unknown cost or reserve reached");
    const files = {
      "README.md": initial,
      "package.json": JSON.stringify({ name: "trial-project", scripts: { test: "trial-check" } }),
    };
    const calls = [];
    const fetched = new Set();
    let checked = false;
    let callCost = 0;
    const cfg = configs[role];
    const model = variant === "baseline" ? baseModels[role] : cfg.model;
    const common = {
      read_file: tool({
        description: "Read a supplied file from the isolated in-memory repository.",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          calls.push("read_file");
          return files[path.replace("/workspace/repo/", "")] ?? "File not found";
        },
      }),
    };
    const tools =
      role === "researcher"
        ? {
            web_search: tool({
              description:
                "Search the two official documentation snapshots supplied for this controlled test.",
              inputSchema: z.object({ query: z.string() }),
              execute: async () => {
                calls.push("web_search");
                return Object.keys(sources);
              },
            }),
            web_fetch: tool({
              description: "Read one supplied official documentation snapshot.",
              inputSchema: z.object({ url: z.string() }),
              execute: async ({ url }) => {
                calls.push("web_fetch");
                if (url in sources) fetched.add(url);
                return sources[url] ?? "Source unavailable";
              },
            }),
          }
        : role === "analyst"
          ? common
          : {
              ...common,
              write_file: tool({
                description:
                  "Replace README.md inside this in-memory trial; no host file is modified.",
                inputSchema: z.object({ path: z.string(), content: z.string() }),
                execute: async ({ path, content }) => {
                  calls.push("write_file");
                  if (path.replace("/workspace/repo/", "") !== "README.md")
                    return "Only README.md is writable";
                  files["README.md"] = content;
                  return "Updated README.md";
                },
              }),
              run_checks: tool({
                description:
                  "Run the trial checks: preserve original README, add Reporting bugs with version and reproduction steps.",
                inputSchema: z.object({}),
                execute: async () => {
                  calls.push("run_checks");
                  checked =
                    files["README.md"].startsWith(initial) &&
                    /## Reporting bugs/.test(files["README.md"]) &&
                    /version/i.test(files["README.md"]) &&
                    /reproduc/i.test(files["README.md"]);
                  return { passed: checked };
                },
              }),
            };
    const task =
      role === "researcher"
        ? "Compare Luna and GPT-5.4 Mini standard input/output token prices, verify xhigh support for Luna, and explain why token-price savings do not guarantee total workflow savings. Use the supplied snapshot tools; do not claim live web research."
        : role === "analyst"
          ? "Plan adding a short Reporting bugs section to README.md asking for version and reproduction steps, preserving existing content. Inspect the supplied files and return your normal planning contract."
          : "Implement this plan: read README.md, append a Reporting bugs section asking reporters for version and reproduction steps, preserve all existing content, then run_checks. Return your normal implementation contract. Publication is deliberately unavailable: pushed must be false and known_limitations must explain this. Use base main and local branch eve/docs-reporting-bugs as labels only; no Git execution is available.";
    const start = Date.now();
    let output, error;
    let usage, finishReason;
    try {
      const result = await generateText({
        model: gateway(model),
        ...(variant === "candidate" ? { reasoning: cfg.reasoning } : {}),
        system:
          readFileSync(`agent/subagents/${role}/instructions.md`, "utf8") +
          "\n\nControlled trial environment: only the tools actually supplied here exist. This environment replaces production checkout, shell, artifact storage, and publication. Do not invent tool execution, commits, or publication. Use the supplied tools and explicitly state unavailable capabilities.",
        prompt: task,
        tools,
        stopWhen: stepCountIs(6),
        maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90000),
        output: Output.object({ schema: jsonSchema(cfg.outputSchema) }),
        prepareStep: async () => {
          if (unknownCost || spent >= 0.75) throw Error("Budget reserve reached");
          return {};
        },
        onStepFinish: async (step) => {
          const rawCost = step.providerMetadata?.gateway?.cost;
          const c = Number(rawCost);
          if (rawCost == null || !Number.isFinite(c) || c < 0) {
            unknownCost = true;
          } else {
            spent += c;
            callCost += c;
          }
          save();
        },
      });
      usage = result.totalUsage;
      finishReason = result.finishReason;
      output = result.output;
    } catch (e) {
      error = String(e.message).replaceAll(key, "<redacted>");
      usage ??= e.usage;
      finishReason ??= e.finishReason;
    }
    const checks =
      role === "analyst"
        ? {
            readFiles: calls.includes("read_file"),
            namesReadme: output?.affected_surface?.some((x) => x.includes("README.md")) === true,
            hasCriteria: (output?.acceptance_criteria?.length ?? 0) > 0,
          }
        : role === "implementer"
          ? {
              readFiles: calls.includes("read_file"),
              readmeChecksPassed: checked,
              publishingHonest:
                output?.pushed === false && (output?.known_limitations?.length ?? 0) > 0,
            }
          : {
              readBothSources: fetched.size === 2,
              citationsFetched:
                output?.findings?.length > 0 &&
                output.findings.every((f) => f.sources.every((s) => fetched.has(s.url))),
              hasPriceComparison:
                /0\.20?\b/.test(JSON.stringify(output ?? {})) &&
                JSON.stringify(output ?? {}).includes("0.75"),
            };
    records.push({
      role,
      variant,
      model,
      reasoning: variant === "candidate" ? cfg.reasoning : "provider-default",
      durationMs: Date.now() - start,
      costUsd: unknownCost ? null : callCost,
      usage,
      finishReason,
      checks,
      passed: !error && Object.values(checks).every(Boolean),
      calls,
      output,
      error,
    });
    save();
    console.log(JSON.stringify({ role, variant, model, costUsd: callCost, spent, checks, error }));
  }
}
process.exitCode = records.every((record) => record.passed) ? 0 : 1;
