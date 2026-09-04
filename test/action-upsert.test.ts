/**
 * Tests for the GitHub Action's sticky-comment upsert script and action.yml
 * contract shape. The upsert script is plain zero-dependency Node (.mjs) with
 * an injectable fetch, so everything here runs against a stub.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  MAX_BODY_LENGTH,
  failureReportBody,
  parseNextLink,
  prepareReportBody,
  REPORT_MARKER,
  reportMarker,
  truncateBody,
  upsertComment,
} from "../action/upsert-comment.mjs"; // plain .mjs module, no type declarations on purpose

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

function makeResponse({
  status = 200,
  json = null as unknown,
  headers = {} as Record<string, string>,
}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

type Handler = (call: RecordedCall) => ReturnType<typeof makeResponse>;

function stubFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (url: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const call: RecordedCall = {
      url,
      method: options.method ?? "GET",
      body: options.body === undefined ? undefined : JSON.parse(options.body),
      headers: options.headers ?? {},
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

const BASE_ARGS = {
  token: "tok",
  repo: "octo/diff0",
  prNumber: 7,
  apiUrl: "https://api.github.com",
};

const REPORT_BODY = `${REPORT_MARKER}\n\n## diff0 report\n\nAll green.`;

// ---------------------------------------------------------------------------
// upsertComment
// ---------------------------------------------------------------------------

describe("upsertComment", () => {
  it("creates a new comment when no marker comment exists", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") return makeResponse({ json: [{ id: 1, body: "unrelated" }] });
      if (call.method === "POST") return makeResponse({ status: 201, json: { id: 42 } });
      throw new Error(`unexpected ${call.method}`);
    });

    const result = await upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY });

    expect(result).toEqual({ action: "created", commentId: 42 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/octo/diff0/issues/7/comments?per_page=100",
    );
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toBe("https://api.github.com/repos/octo/diff0/issues/7/comments");
    expect((calls[1]?.body as { body: string }).body).toContain(REPORT_MARKER);
    expect(calls[1]?.headers.authorization).toBe("Bearer tok");
  });

  it("updates (PATCHes) the first comment containing the marker", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        return makeResponse({
          json: [
            { id: 1, body: "just a human comment" },
            { id: 2, body: `${REPORT_MARKER}\nold report` },
            { id: 3, body: `${REPORT_MARKER}\na stray duplicate` },
          ],
        });
      }
      if (call.method === "PATCH") return makeResponse({ json: { id: 2 } });
      throw new Error(`unexpected ${call.method}`);
    });

    const result = await upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY });

    expect(result).toEqual({ action: "updated", commentId: 2 });
    expect(calls[1]?.method).toBe("PATCH");
    // PATCH goes to the comment endpoint (no issue number), targeting the FIRST match.
    expect(calls[1]?.url).toBe("https://api.github.com/repos/octo/diff0/issues/comments/2");
    expect((calls[1]?.body as { body: string }).body).toBe(REPORT_BODY);
  });

  it("skips a spoofed marker comment that the token cannot edit", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        return makeResponse({
          json: [
            { id: 1, body: `${REPORT_MARKER}\nspoof` },
            { id: 2, body: `${REPORT_MARKER}\nreal report` },
          ],
        });
      }
      if (call.method === "PATCH" && call.url.endsWith("/1")) {
        return makeResponse({ status: 403, json: { message: "Forbidden" } });
      }
      if (call.method === "PATCH" && call.url.endsWith("/2")) {
        return makeResponse({ json: { id: 2 } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).resolves.toEqual({
      action: "updated",
      commentId: 2,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH", "PATCH"]);
  });

  it("refuses cross-origin pagination before forwarding the token", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        return makeResponse({
          json: [],
          headers: { Link: '<https://attacker.invalid/steal>; rel="next"' },
        });
      }
      throw new Error(`unexpected ${call.method}`);
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).rejects.toThrow(
      /unexpected pagination origin/,
    );
    expect(calls).toHaveLength(1);
  });

  it("paginates across pages via the Link header before deciding", async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: i, body: `noise ${i}` }));
    const nextUrl =
      "https://api.github.com/repos/octo/diff0/issues/7/comments?per_page=100&page=2";
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET" && !call.url.includes("page=2")) {
        return makeResponse({
          json: pageOne,
          headers: { Link: `<${nextUrl}>; rel="next", <https://example.com?page=1>; rel="prev"` },
        });
      }
      if (call.method === "GET") {
        return makeResponse({ json: [{ id: 555, body: `${REPORT_MARKER} old` }] });
      }
      if (call.method === "PATCH") return makeResponse({ json: { id: 555 } });
      throw new Error(`unexpected ${call.method}`);
    });

    const result = await upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY });

    expect(result).toEqual({ action: "updated", commentId: 555 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PATCH"]);
    expect(calls[1]?.url).toBe(nextUrl);
    expect(calls[2]?.url).toBe("https://api.github.com/repos/octo/diff0/issues/comments/555");
  });

  it("fails 403 with an actionable message about pull-requests: write", async () => {
    const { fetchImpl } = stubFetch(() =>
      makeResponse({ status: 403, json: { message: "Resource not accessible by integration" } }),
    );

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).rejects.toThrow(
      /pull-requests: write/,
    );
  });

  it("truncates oversized bodies below GitHub's 65536 cap with a notice", async () => {
    const huge = `${REPORT_MARKER}\n${"x".repeat(80_000)}`;
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") return makeResponse({ json: [] });
      return makeResponse({ status: 201, json: { id: 9 } });
    });

    await upsertComment({ ...BASE_ARGS, fetchImpl, body: huge });

    const posted = (calls[1]?.body as { body: string }).body;
    expect(posted.length).toBeLessThan(65_536);
    expect(posted).toContain(REPORT_MARKER);
    expect(posted).toContain("truncated");
    expect(posted.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(posted).toContain("report-md");
  });

  it("retries a network error once, then succeeds", async () => {
    let attempts = 0;
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        attempts += 1;
        if (attempts === 1) throw new TypeError("fetch failed: ECONNRESET");
        return makeResponse({ json: [] });
      }
      return makeResponse({ status: 201, json: { id: 1 } });
    });

    const result = await upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY });

    expect(result.action).toBe("created");
    // First GET threw, second GET succeeded, then the POST.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST"]);
  });

  it("gives up with a network error message after the single retry fails", async () => {
    const { fetchImpl, calls } = stubFetch(() => {
      throw new TypeError("fetch failed: EAI_AGAIN");
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).rejects.toThrow(
      /Network error .*after one retry/,
    );
    expect(calls).toHaveLength(2);
  });

  it("retries a transient server response for an idempotent request", async () => {
    let lists = 0;
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        lists += 1;
        return lists === 1
          ? makeResponse({ status: 502, json: { message: "upstream reset" } })
          : makeResponse({ json: [] });
      }
      return makeResponse({ status: 201, json: { id: 9 } });
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).resolves.toEqual({
      action: "created",
      commentId: 9,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "POST"]);
  });

  it("re-lists after a lost create response instead of posting twice", async () => {
    let listed = false;
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        const comments = listed ? [{ id: 77, body: REPORT_BODY }] : [];
        listed = true;
        return makeResponse({ json: comments });
      }
      if (call.method === "POST") throw new TypeError("response lost");
      if (call.method === "PATCH") return makeResponse({ json: { id: 77 } });
      throw new Error(`unexpected ${call.method}`);
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).resolves.toEqual({
      action: "updated",
      commentId: 77,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET", "PATCH"]);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("fails safely when an ambiguous create leaves no marker comment", async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") return makeResponse({ json: [] });
      if (call.method === "POST") throw new TypeError("response lost");
      throw new Error(`unexpected ${call.method}`);
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body: REPORT_BODY })).rejects.toThrow(
      /ambiguous network failure/,
    );
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

describe("truncateBody", () => {
  it("returns short bodies unchanged", () => {
    expect(truncateBody("short")).toBe("short");
  });

  it("caps at MAX_BODY_LENGTH plus the notice", () => {
    const out = truncateBody(`${"y".repeat(MAX_BODY_LENGTH)}\nextra`);
    expect(out.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(out).toContain("truncated");
    expect(out).toContain("report-md");
  });
});

describe("failureReportBody", () => {
  it("replaces a stale successful report with current failure context", () => {
    const body = failureReportBody({
      cliExit: "3",
      baseRef: "abc123",
      headRef: "def456",
      headSha: "def456",
    });
    expect(body).toContain(REPORT_MARKER);
    expect(body).toContain("could not produce a report");
    expect(body).toContain("exit code **3**");
    expect(body).toContain("replaced the previous diff0 result");
  });
});

describe("parseNextLink", () => {
  it("extracts rel=next and ignores other rels", () => {
    const header =
      '<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
    expect(parseNextLink(header)).toBe("https://api.github.com/x?page=3");
  });

  it("returns null without a next link", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  });
});

describe("named sticky reports", () => {
  it("keeps the legacy marker when no key is provided", () => {
    expect(reportMarker()).toBe(REPORT_MARKER);
    expect(prepareReportBody(REPORT_BODY)).toBe(REPORT_BODY);
  });

  it("gives each valid key an independent marker", () => {
    expect(reportMarker("factory")).toBe("<!-- diff0-report:factory -->");
    expect(prepareReportBody(REPORT_BODY, "factory")).toContain(
      "<!-- diff0-report:factory -->",
    );
  });

  it("rejects keys that cannot safely form a marker", () => {
    expect(() => reportMarker("factory --> injected")).toThrow(/Invalid comment key/);
    expect(() => reportMarker("x".repeat(65))).toThrow(/Invalid comment key/);
  });

  it("matches only the requested named report", async () => {
    const marker = reportMarker("factory");
    const body = prepareReportBody(REPORT_BODY, "factory");
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.method === "GET") {
        return makeResponse({
          json: [
            { id: 1, body: REPORT_BODY },
            { id: 2, body: `${marker}\nold factory report` },
          ],
        });
      }
      if (call.method === "PATCH") return makeResponse({ json: { id: 2 } });
      throw new Error(`unexpected ${call.method}`);
    });

    await expect(upsertComment({ ...BASE_ARGS, fetchImpl, body, marker })).resolves.toEqual({
      action: "updated",
      commentId: 2,
    });
    expect(calls[1]?.url).toMatch(/comments\/2$/);
  });
});

// ---------------------------------------------------------------------------
// action.yml contract shape
// ---------------------------------------------------------------------------

describe("action/action.yml", () => {
  const yml = readFileSync(new URL("../action/action.yml", import.meta.url), "utf8");
  const action = parseYaml(yml) as {
    inputs: Record<string, { default?: unknown }>;
    runs: { using: string; steps: Array<Record<string, unknown>> };
  };

  it("declares exactly the contract's inputs", () => {
    expect(Object.keys(action.inputs).sort()).toEqual(
      [
        "base",
        "allow-untrusted-head",
        "comment-key",
        "evals",
        "fail-on",
        "github-token",
        "head",
        "install-mode",
        "max-cost-increase-pct",
        "max-duration-increase-pct",
        "max-input-token-increase-pct",
        "max-output-token-increase-pct",
        "max-spend",
        "runs",
        "validity-paths",
        "working-directory",
      ].sort(),
    );
  });

  it("uses the contract's defaults", () => {
    expect(action.inputs.base?.default).toBe("${{ github.event.pull_request.base.sha }}");
    expect(action.inputs.head?.default).toBe("${{ github.event.pull_request.head.sha }}");
    expect(action.inputs.runs?.default).toBe("3");
    expect(action.inputs["fail-on"]?.default).toBe("regression");
    expect(action.inputs["install-mode"]?.default).toBe("scripts-off");
    expect(action.inputs["working-directory"]?.default).toBe(".");
    expect(action.inputs["github-token"]?.default).toBe("${{ github.token }}");
    expect(action.inputs["comment-key"]?.default).toBe("");
    expect(action.inputs["allow-untrusted-head"]?.default).toBe("false");
    expect(action.inputs["validity-paths"]?.default).toBe("");
    expect(action.inputs["max-cost-increase-pct"]?.default).toBe("");
    expect(action.inputs["max-input-token-increase-pct"]?.default).toBe("");
    expect(action.inputs["max-output-token-increase-pct"]?.default).toBe("");
    expect(action.inputs["max-duration-increase-pct"]?.default).toBe("");
  });

  it("is a composite action with no third-party action steps", () => {
    expect(action.runs.using).toBe("composite");
    expect(action.runs.steps.every((step) => !("uses" in step))).toBe(true);
  });

  it("runs the CLI with --fail-on never and enforces the input separately", () => {
    expect(yml).toContain("--fail-on never");
    expect(yml).toMatch(/name: Enforce fail-on policy/);
  });

  it("fails closed when the JSON artifact has a missing or unknown verdict", () => {
    expect(yml).toContain('report.schemaVersion !== 4');
    expect(yml).toContain('!["green", "yellow", "red"].includes(report.verdict)');
    expect(yml).toContain("report.enforcement?.violations");
    expect(yml).toContain("JSON report has an unsupported schema or invalid verdict/enforcement data");
  });

  it("guards the comment step to pull_request events", () => {
    expect(yml).toMatch(/if: github\.event_name == 'pull_request'/);
    expect(yml).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  it("refuses untrusted PR heads and uses the bundled CLI", () => {
    expect(yml).toContain("name: Enforce the PR trust boundary");
    expect(yml).toContain("pull_request_target");
    expect(yml).toContain("allow-untrusted-head");
    expect(yml).toContain("invalid comment-key");
    expect(yml).toContain("checkout credentials are persisted");
    expect(yml).toContain("includeIf\\.gitdir");
    expect(yml).toContain("git-credentials-");
    expect(yml).toContain("persist-credentials: false");
    expect(yml).toContain("corepack enable");
    expect(yml).not.toContain("pnpm install --frozen-lockfile");
    expect(yml).toContain('node "$GITHUB_ACTION_PATH/dist/cli.mjs"');
    expect(yml).toContain('mktemp -d "$RUNNER_TEMP/diff0.XXXXXX"');
    expect(yml).not.toContain('$RUNNER_TEMP/diff0-report.md');
    expect(yml).toContain("install-mode:");
    expect(yml).toContain('default: "scripts-off"');
    expect(yml).toContain('scripts-off|scripts-on) ;;');
    expect(yml).toContain("install-mode 'safe' is deprecated");
    expect(yml).toContain("install-mode 'trusted' is deprecated");
    expect(yml).toContain('--install-mode "$INPUT_INSTALL_MODE"');
    expect(yml).toContain('--validity-path "$INPUT_VALIDITY_PATHS"');
    expect(yml).toContain('--max-cost-increase-pct "$INPUT_MAX_COST_INCREASE_PCT"');
    expect(yml).toContain('--max-input-token-increase-pct "$INPUT_MAX_INPUT_TOKEN_INCREASE_PCT"');
    expect(yml).toContain('--max-output-token-increase-pct "$INPUT_MAX_OUTPUT_TOKEN_INCREASE_PCT"');
    expect(yml).toContain('--max-duration-increase-pct "$INPUT_MAX_DURATION_INCREASE_PCT"');
    expect(yml).toContain("scripts-on mode executes lifecycle/build scripts");
    expect(yml).not.toContain("skipping the PR comment");
    expect(yml).toContain("BASE_REF: ${{ inputs.base }}");
  });

  it("rejects invalid granular policy and performance inputs before invoking diff0", () => {
    const runStep = action.runs.steps.find((step) => step.name === "Run diff0");
    const baseEnv = {
      ...process.env,
      INPUT_BASE: "main",
      INPUT_HEAD: "HEAD",
      INPUT_RUNS: "3",
      INPUT_EVALS: "",
      INPUT_VALIDITY_PATHS: "",
      INPUT_FAIL_ON: "regression",
      INPUT_MAX_SPEND: "",
      INPUT_MAX_COST_INCREASE_PCT: "",
      INPUT_MAX_INPUT_TOKEN_INCREASE_PCT: "",
      INPUT_MAX_OUTPUT_TOKEN_INCREASE_PCT: "",
      INPUT_MAX_DURATION_INCREASE_PCT: "",
      INPUT_WORKING_DIRECTORY: ".",
      INPUT_INSTALL_MODE: "scripts-off",
    };
    for (const overrides of [
      { INPUT_FAIL_ON: "regression,performance-regression" },
      { INPUT_MAX_DURATION_INCREASE_PCT: "-1" },
    ]) {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", String(runStep?.run)], {
        encoding: "utf8",
        env: { ...baseEnv, ...overrides },
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("::error::diff0: invalid");
      expect(result.stdout).not.toContain("diff0 CLI exited");
    }
  });

  it("enforces selected granular categories from schema 4 JSON", () => {
    const scratch = mkdtempSync(join(tmpdir(), "diff0-action-enforcement-"));
    const reportPath = join(scratch, "report.json");
    const outputPath = join(scratch, "output.txt");
    const enforceStep = action.runs.steps.find((step) => step.name === "Enforce fail-on policy");
    writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 4,
        verdict: "red",
        enforcement: {
          violations: [
            {
              category: "performance-regression",
              reasons: ["duration delta +150% exceeds +100% threshold"],
            },
          ],
        },
      }),
    );
    try {
      const run = (failOn: string) =>
        spawnSync("bash", ["-e", "-o", "pipefail", "-c", String(enforceStep?.run)], {
          encoding: "utf8",
          env: {
            ...process.env,
            CLI_EXIT: "0",
            FAIL_ON: failOn,
            REPORT_JSON: reportPath,
            GITHUB_OUTPUT: outputPath,
          },
        });

      expect(run("performance-regression").status).toBe(1);
      expect(run("score-regression").status).toBe(0);
      expect(run(" regression ").status).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("actually rejects checkout v7's includeIf credential config", () => {
    const scratch = mkdtempSync(join(tmpdir(), "diff0-action-credentials-"));
    const repo = join(scratch, "repo");
    try {
      execFileSync("git", ["init", "-q", repo]);
      execFileSync("git", [
        "-C",
        repo,
        "config",
        "--local",
        `includeIf.gitdir:${repo}/.git/worktrees/*.path`,
        join(scratch, "git-credentials-deadbeef.config"),
      ]);
      const trustStep = action.runs.steps.find(
        (step) => step.name === "Enforce the PR trust boundary",
      );
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", String(trustStep?.run)], {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WORKSPACE: repo,
          EVENT_NAME: "push",
          IS_FORK_PR: "false",
          ALLOW_UNTRUSTED_HEAD: "false",
          COMMENT_KEY: "",
        },
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("persisted through a Git includeIf credential config");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("ships token-safe examples and restricts paid dogfood runs to the repository owner", () => {
    const root = new URL("..", import.meta.url);
    for (const path of [
      "README.md",
      "action/README.md",
      "website/content/action.yml",
      ".github/workflows/diff0.yml",
    ]) {
      expect(readFileSync(new URL(path, root), "utf8"), path).toContain(
        "persist-credentials: false",
      );
    }

    const dogfood = readFileSync(new URL(".github/workflows/diff0.yml", root), "utf8");
    expect(dogfood).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(dogfood).toContain(
      "github.event.pull_request.user.login == github.repository_owner",
    );
    expect(dogfood).toContain("github.actor == github.repository_owner");
    expect(dogfood).toContain("AI_GATEWAY_API_KEY: ${{ secrets.DIFF0_AI_GATEWAY_API_KEY }}");
    expect(dogfood).toContain("DIFF0_DEMO_MODEL: anthropic/claude-haiku-4.5");
    expect(dogfood).toContain('runs: "10"');
    expect(dogfood).toContain('max-spend: "0.30"');
    expect(dogfood).toContain("cancel-in-progress: true");
  });
});
