#!/usr/bin/env node
/**
 * Sticky PR comment upsert for the diff0 GitHub Action.
 *
 * Plain Node 20+ (global fetch), zero dependencies — this file runs straight
 * from the action checkout without a build step, so it must not import
 * anything from src/ or node_modules.
 *
 * Behavior: list the PR's issue comments (paginated), find the FIRST comment
 * containing REPORT_MARKER and PATCH it; otherwise POST a new comment.
 *
 * Env contract (set by action/action.yml):
 *   GITHUB_TOKEN       — token with pull-requests: write
 *   GITHUB_REPOSITORY  — "owner/repo" (default runner env)
 *   PR_NUMBER          — pull request number
 *   REPORT_PATH        — path to the markdown report
 *   COMMENT_KEY        — optional stable key for multiple diff0 reports on one PR
 *   GITHUB_API_URL     — optional, defaults to https://api.github.com
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Upsert anchor. Source of truth: `REPORT_MARKER` in src/report/markdown.ts —
 * hardcoded here (with this pointer) so the script stays dependency-free.
 */
export const REPORT_MARKER = "<!-- diff0-report -->";

const COMMENT_KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Resolve the sticky marker for one optional named report stream. */
export function reportMarker(commentKey = "") {
  const key = commentKey.trim();
  if (!key) return REPORT_MARKER;
  if (!COMMENT_KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid comment key "${commentKey}". Use 1-64 letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return `<!-- diff0-report:${key} -->`;
}

/** Replace the CLI's generic marker with the marker for this Action invocation. */
export function prepareReportBody(body, commentKey = "") {
  if (!body.includes(REPORT_MARKER)) {
    throw new Error(`The report does not contain the diff0 marker ("${REPORT_MARKER}").`);
  }
  return body.replace(REPORT_MARKER, reportMarker(commentKey));
}

/**
 * GitHub caps issue-comment bodies at 65536 characters. Truncate at 65000 so
 * the truncation notice always fits.
 */
export const MAX_BODY_LENGTH = 65000;

const TRUNCATION_NOTICE =
  "\n\n> ⚠️ Report truncated at a line boundary because it exceeded GitHub's comment limit. " +
  "The complete Markdown remains at the Action's `report-md` output; upload that path as a workflow artifact to retain it.";

/** Truncate a comment body to fit GitHub's limit, appending a notice when cut. */
export function truncateBody(body) {
  if (body.length <= MAX_BODY_LENGTH) return body;
  const budget = MAX_BODY_LENGTH - TRUNCATION_NOTICE.length;
  const candidate = body.slice(0, budget);
  const lastNewline = candidate.lastIndexOf("\n");
  const safeEnd = lastNewline > 0 ? lastNewline : budget;
  return body.slice(0, safeEnd) + TRUNCATION_NOTICE;
}

function markdownText(value) {
  return String(value || "unknown")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll("|", "&#124;");
}

/** Sticky failure body used when the CLI exits before it can write a report. */
export function failureReportBody({ cliExit, baseRef, headRef, headSha }) {
  return `${REPORT_MARKER}

## diff0 could not produce a report

> ❌ The comparison stopped with CLI exit code **${markdownText(cliExit)}**. See the failed workflow step for the exact error.

| Input | Value |
| --- | --- |
| Base | ${markdownText(baseRef)} |
| Head | ${markdownText(headRef)} |
| Workflow commit | ${markdownText(headSha)} |

This comment replaced the previous diff0 result so it cannot be mistaken for the current run.`;
}

/** Extract the rel="next" URL from an RFC 5988 Link header, or null. */
export function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Fetch with auth headers; idempotent requests retry one transient failure. */
async function request(fetchImpl, url, { token, method = "GET", body }) {
  const options = {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "diff0-action",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  const mayRetry = method === "GET" || method === "HEAD" || method === "PATCH";
  for (let attempt = 0; attempt < (mayRetry ? 2 : 1); attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (mayRetry && attempt === 0 && (response.status === 429 || response.status >= 500)) {
        continue;
      }
      return response;
    } catch (error) {
      if (mayRetry && attempt === 0) continue;
      throw new Error(
        `Network error calling ${method} ${url}${mayRetry ? " (after one retry)" : ""}: ${errorMessage(error)}`,
      );
    }
  }
  throw new Error(`Request failed unexpectedly: ${method} ${url}`);
}

async function ensureOk(response, what) {
  if (response.ok) return;
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    // Body unavailable — the status alone will have to do.
  }
  const suffix = detail ? ` API response: ${detail}` : "";
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `GitHub API ${what} failed with ${response.status}. The token cannot write PR comments — ` +
        `make sure the calling workflow grants "permissions: pull-requests: write" and that the ` +
        `github-token input is valid.${suffix}`,
    );
  }
  throw new Error(`GitHub API ${what} failed with ${response.status}.${suffix}`);
}

/**
 * Core upsert, injectable for tests.
 * Returns { action: "created" | "updated", commentId }.
 */
export async function upsertComment({
  fetchImpl = fetch,
  token,
  repo,
  prNumber,
  body,
  marker = REPORT_MARKER,
  apiUrl = "https://api.github.com",
}) {
  const finalBody = truncateBody(body);
  const base = apiUrl.replace(/\/+$/, "");

  const listCandidates = async () => {
    const candidates = [];
    let url = `${base}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
    while (url) {
      if (new URL(url).origin !== new URL(base).origin) {
        throw new Error(`Refusing to send the GitHub token to an unexpected pagination origin.`);
      }
      const response = await request(fetchImpl, url, { token });
      await ensureOk(response, `listing comments on PR #${prNumber}`);
      const comments = await response.json();
      candidates.push(
        ...comments.filter(
          (comment) => typeof comment.body === "string" && comment.body.includes(marker),
        ),
      );
      url = parseNextLink(response.headers.get("link"));
    }
    return candidates;
  };

  // Foreign users can copy the marker. Update only a comment this token can edit.
  const updateCandidate = async (candidates) => {
    for (const existing of candidates) {
      const response = await request(
        fetchImpl,
        `${base}/repos/${repo}/issues/comments/${existing.id}`,
        {
          token,
          method: "PATCH",
          body: { body: finalBody },
        },
      );
      if (response.status === 403 || response.status === 404) continue;
      await ensureOk(response, `updating comment ${existing.id}`);
      return { action: "updated", commentId: existing.id };
    }
    return null;
  };

  const updated = await updateCandidate(await listCandidates());
  if (updated !== null) return updated;

  let response;
  try {
    response = await request(fetchImpl, `${base}/repos/${repo}/issues/${prNumber}/comments`, {
      token,
      method: "POST",
      body: { body: finalBody },
    });
  } catch (error) {
    // A POST may have succeeded even if its response was lost. Re-list instead
    // of retrying the non-idempotent create and risking a duplicate comment.
    const recovered = await updateCandidate(await listCandidates());
    if (recovered !== null) return recovered;
    throw new Error(
      `Comment creation had an ambiguous network failure and no marker comment was found: ${errorMessage(error)}`,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    const recovered = await updateCandidate(await listCandidates());
    if (recovered !== null) return recovered;
  }
  await ensureOk(response, `creating a comment on PR #${prNumber}`);
  const created = await response.json();
  return { action: "created", commentId: created.id };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const prNumber = requireEnv("PR_NUMBER");
  const reportPath = requireEnv("REPORT_PATH");
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const commentKey = process.env.COMMENT_KEY || "";

  let body;
  try {
    body = readFileSync(reportPath, "utf8");
  } catch (error) {
    if (!process.env.CLI_EXIT) {
      throw new Error(
        `Could not read the markdown report at ${reportPath}: ${errorMessage(error)}`,
      );
    }
    body = failureReportBody({
      cliExit: process.env.CLI_EXIT,
      baseRef: process.env.BASE_REF,
      headRef: process.env.HEAD_REF,
      headSha: process.env.HEAD_SHA,
    });
  }
  if (!body.includes(REPORT_MARKER)) {
    throw new Error(
      `The report at ${reportPath} does not contain the diff0 marker ("${REPORT_MARKER}") — ` +
        `refusing to post it. The marker is what makes the comment sticky (see src/report/markdown.ts).`,
    );
  }

  const marker = reportMarker(commentKey);
  body = prepareReportBody(body, commentKey);
  const result = await upsertComment({ token, repo, prNumber, body, marker, apiUrl });
  console.log(`diff0: ${result.action} sticky PR comment (id ${result.commentId}).`);
}

// Only run main() when executed directly (the test suite imports this module).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`diff0 upsert-comment: ${errorMessage(error)}`);
    process.exit(1);
  });
}
