/** Paid coding experiment. Requires Node's filesystem AND network permission controls. */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGateway, generateText, jsonSchema, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import implementer from "../agent/subagents/implementer/agent.js";
import reviewer from "../agent/subagents/reviewer/agent.js";
import { cases } from "./fixtures/coding-trial.mjs";

if (!process.allowedNodeEnvironmentFlags.has("--allow-net"))
  throw Error("Use Node with --permission and --allow-net support (tested on Node 26).");
const key = process.env.AI_GATEWAY_API_KEY;
if (!key) throw Error("Missing AI_GATEWAY_API_KEY");
const gateway = createGateway({ apiKey: key });
const outputDir = resolve(".eve/coding-trial");
mkdirSync(outputDir, { recursive: true });
const records = [];
let spent = 0,
  unknownCost = false;
const save = () =>
  writeFileSync(
    join(outputDir, "results.json"),
    JSON.stringify(
      {
        kind: "scratch-coding-pilot",
        spendTargetUsd: 2,
        totalCostUsd: spent,
        unknownCost,
        records,
      },
      null,
      2,
    ),
  );
const cleanEnv = { PATH: process.env.PATH, LANG: "en_US.UTF-8" };
function check(dir, tests) {
  const token = randomUUID();
  const driver = `import assert from 'node:assert/strict'; import * as subject from ${JSON.stringify(pathToFileURL(join(dir, "index.mjs")).href)};\n${tests}\nconsole.log(${JSON.stringify(token)});`;
  try {
    const out = execFileSync(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${dir}`,
        "--max-old-space-size=64",
        "--input-type=module",
        "-",
      ],
      {
        input: driver,
        cwd: dir,
        env: cleanEnv,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 16000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return {
      passed: out.trim().split("\n").includes(token),
      detail: out.trim().split("\n").includes(token)
        ? "All acceptance assertions completed."
        : "Acceptance driver did not complete.",
    };
  } catch (e) {
    return { passed: false, detail: String(e.stderr ?? e.message).slice(-3000) };
  }
}
// Verify the boundary before running generated code. No model credentials enter this process.
const guardDir = realpathSync(mkdtempSync(join(tmpdir(), "diff0-coding-guard-")));
writeFileSync(join(guardDir, "index.mjs"), "export const marker = 1;");
const guard = check(
  guardDir,
  `const fs=await import('node:fs');const cp=await import('node:child_process');assert.throws(()=>fs.readFileSync('/etc/hosts'), {code:'ERR_ACCESS_DENIED'});assert.throws(()=>fs.writeFileSync('forbidden','x'), {code:'ERR_ACCESS_DENIED'});assert.throws(()=>cp.execFileSync('true'), {code:'ERR_ACCESS_DENIED'});await assert.rejects(fetch('https://example.com'), e => e.code === 'ERR_ACCESS_DENIED' || e.cause?.code === 'ERR_ACCESS_DENIED');`,
);
if (!guard.passed)
  throw Error(`Node permission checks failed; refusing to run generated code: ${guard.detail}`);
for (const [caseIndex, c] of cases.entries()) {
  for (const variant of caseIndex % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
    if (unknownCost || spent >= 1.5) throw Error("Spend reserve reached or cost unavailable");
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `diff0-code-${c.name}-${variant}-`)));
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-C",
          dir,
          "-c",
          "user.name=diff0 trial",
          "-c",
          "user.email=trial@example.invalid",
          ...args,
        ],
        { encoding: "utf8", env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    writeFileSync(join(dir, "index.mjs"), c.source);
    git("init", "-q", "--initial-branch=main");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const baseSha = git("rev-parse", "HEAD");
    git("checkout", "-qb", "eve/trial");
    const baselineCheck = check(dir, c.tests);
    if (baselineCheck.passed !== (c.name === "summary-refactor"))
      throw Error("Fixture did not have expected baseline outcome");
    const result = {
      task: c.name,
      variant,
      model: variant === "baseline" ? "anthropic/claude-sonnet-5" : implementer.model,
      reasoning: variant === "baseline" ? "provider-default" : implementer.reasoning,
      attempts: [],
      baselinePassed: baselineCheck.passed,
    };
    records.push(result);
    let feedback = "";
    const runStart = Date.now();
    const costStart = spent;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const calls = [];
      const runModel = async (role, config, prompt, tools) => {
        const start = Date.now(),
          before = spent;
        let output, error, usage, finishReason;
        try {
          const r = await generateText({
            model: gateway(role === "implementer" ? result.model : config.model),
            ...(role === "implementer" && variant === "candidate"
              ? { reasoning: implementer.reasoning }
              : {}),
            system:
              readFileSync(`agent/subagents/${role}/instructions.md`, "utf8") +
              "\n\nThis is an isolated scratch coding experiment. Only the supplied tools exist. No shell, publication, or production checkout exists. Report unavailable operations honestly. index.mjs is the entire source module. Do not pretend to commit or push.",
            prompt,
            tools,
            output: Output.object({ schema: jsonSchema(config.outputSchema) }),
            stopWhen: stepCountIs(8),
            maxOutputTokens: 4096,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(120000),
            prepareStep: async () => {
              if (unknownCost || spent >= 1.5) throw Error("Spend reserve reached");
              return {};
            },
            onStepFinish: async (step) => {
              const raw = step.providerMetadata?.gateway?.cost;
              const cost = Number(raw);
              if (raw == null || !Number.isFinite(cost) || cost < 0) unknownCost = true;
              else spent += cost;
              save();
            },
          });
          usage = r.totalUsage;
          finishReason = r.finishReason;
          output = r.output;
        } catch (e) {
          error = String(e.message).replaceAll(key, "<redacted>");
          usage ??= e.usage;
          finishReason ??= e.finishReason;
        }
        return {
          output,
          error,
          usage,
          finishReason,
          durationMs: Date.now() - start,
          costUsd: unknownCost ? null : spent - before,
        };
      };
      const read = tool({
        description: "Read index.mjs or the immutable acceptance test body tests.mjs.",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          calls.push("read_file");
          return path === "index.mjs"
            ? readFileSync(join(dir, "index.mjs"), "utf8")
            : path === "tests.mjs"
              ? c.tests
              : "File unavailable";
        },
      });
      const tests = tool({
        description:
          "Execute immutable acceptance assertions in a Node process with network, writes, child processes, and outside-file reads denied.",
        inputSchema: z.object({}),
        execute: async () => {
          calls.push("run_checks");
          return check(dir, c.tests);
        },
      });
      const impl = await runModel(
        "implementer",
        implementer,
        `Work item: ${c.request}\nPlan: read index.mjs and tests.mjs; make the minimal change to index.mjs; run_checks; report your result with base main, branch eve/trial, pushed false. No tests can be edited. ${feedback}`,
        {
          read_file: read,
          write_file: tool({
            description: "Replace only index.mjs in the scratch repository.",
            inputSchema: z.object({ path: z.literal("index.mjs"), content: z.string().max(16000) }),
            execute: async ({ content }) => {
              calls.push("write_file");
              writeFileSync(join(dir, "index.mjs"), content);
              return "Updated index.mjs";
            },
          }),
          run_checks: tests,
        },
      );
      const verified = check(dir, c.tests);
      if (git("status", "--porcelain")) {
        git("add", "index.mjs");
        git("commit", "-qm", `trial attempt ${attempt}`);
      }
      const reviewSha = git("rev-parse", "HEAD");
      const diff = git("diff", baseSha, reviewSha, "--", "index.mjs");
      let checkedSha, attestedSha;
      const review = await runModel(
        "reviewer",
        reviewer,
        `Review this scratch change on branch eve/trial, already checked out and committed locally by the trial harness. Complete check_review and then attest_review locally before approving; no remote attestation is requested. Acceptance criteria: ${c.request}\nSource diff:\n${diff}\nIndependent checks: ${JSON.stringify(verified)}\nImplementer report: ${JSON.stringify(impl.output ?? {})}\nPublication is deliberately unavailable and is not an acceptance failure for this experiment. Inspect source/tests and return your normal review contract.`,
        {
          read_file: read,
          check_review: tool({
            description:
              "Complete the local trial acceptance suite on eve/trial. Replaces production checks only in this scratch experiment.",
            inputSchema: z.object({ branch: z.literal("eve/trial") }),
            execute: async () => {
              calls.push("check_review");
              const checked = check(dir, c.tests);
              if (
                checked.passed &&
                git("rev-parse", "HEAD") === reviewSha &&
                !git("status", "--porcelain")
              )
                checkedSha = reviewSha;
              return {
                ...checked,
                complete: true,
                nextCheck: null,
                branch: "eve/trial",
                sha: reviewSha,
                checks: ["scratch acceptance suite"],
              };
            },
          }),
          attest_review: tool({
            description:
              "Record a LOCAL trial attestation after check_review passes. Does not attest a remote branch or authorize publication.",
            inputSchema: z.object({ branch: z.literal("eve/trial") }),
            execute: async () => {
              calls.push("attest_review");
              const success =
                checkedSha === reviewSha &&
                git("rev-parse", "HEAD") === reviewSha &&
                !git("status", "--porcelain");
              if (success) attestedSha = reviewSha;
              return {
                success,
                branch: "eve/trial",
                sha: reviewSha,
                scope: "local trial only",
                checks: ["scratch acceptance suite"],
              };
            },
          }),
        },
      );
      const step = {
        attempt,
        implementation: impl,
        verified,
        review,
        calls,
        diff,
        attested: attestedSha === reviewSha,
      };
      result.attempts.push(step);
      save();
      const reviewed = review.output?.verdict;
      console.log(
        JSON.stringify({
          task: c.name,
          variant,
          attempt,
          tests: verified.passed,
          review: reviewed,
          implementationError: impl.error,
          reviewError: review.error,
          spent,
        }),
      );
      if (
        verified.passed &&
        !impl.error &&
        !review.error &&
        reviewed === "approve" &&
        attestedSha === reviewSha
      ) {
        result.passed = true;
        break;
      }
      feedback = `Revision request: checks ${JSON.stringify(verified)}; reviewer ${JSON.stringify(review.output ?? review.error)}. Address findings; do not broaden scope.`;
    }
    result.passed ??= false;
    result.costUsd = unknownCost ? null : spent - costStart;
    result.durationMs = Date.now() - runStart;
    save();
  }
}
process.exitCode = records.every((r) => r.passed) ? 0 : 1;
