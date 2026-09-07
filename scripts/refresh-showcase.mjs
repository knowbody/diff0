import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { requestGitHub } from "../action/github-request.mjs";
import { REPORT_MARKER, upsertComment } from "../action/upsert-comment.mjs";

export const showcasePath = "fixtures/demo-agent/agent/instructions.md";
const branch = "showcase/live-proof-v3";

export function showcaseInstructions(source) {
  const before =
    "- After computing a figure, delegate a one-line executive summary to the\n  `reporter` subagent before replying.";
  if (source.split(before).length !== 2) {
    throw new Error(
      "The showcase delegation rule changed; review the demo patch before refreshing.",
    );
  }
  return source.replace(
    before,
    "- After computing a figure, give a one-line executive summary before replying.",
  );
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token, GITHUB_OUTPUT } = process.env;
  if (repo !== "knowbody/diff0" || !token || !GITHUB_OUTPUT) {
    throw new Error("Run this through the diff0 showcase workflow.");
  }
  const response = await requestGitHub(fetch, `https://api.github.com/repos/${repo}/pulls/15`, {
    token,
  });
  if (!response.ok) throw new Error(`Cannot read showcase PR: HTTP ${response.status}`);
  const pr = await response.json();
  if (
    pr.state !== "open" ||
    !pr.draft ||
    pr.head?.repo?.full_name !== repo ||
    pr.head.ref !== branch ||
    pr.base?.repo?.full_name !== repo ||
    pr.base.ref !== "main"
  ) {
    throw new Error("PR #15 must remain the open, draft showcase PR targeting main.");
  }
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
  git("fetch", "origin", "main", branch);
  const base = git("rev-parse", "origin/main");
  const oldHead = git("rev-parse", `origin/${branch}`);
  if (oldHead !== pr.head.sha) throw new Error("Showcase moved during refresh; retry.");
  const oldBase = git("merge-base", base, oldHead);
  const read = (ref) =>
    execFileSync("git", ["show", `${ref}:${showcasePath}`], { encoding: "utf8" });
  // Never discard unrelated edits to the long-lived branch.
  if (
    git("diff", "--name-only", oldBase, oldHead) !== showcasePath ||
    read(oldHead) !== showcaseInstructions(read(oldBase))
  ) {
    throw new Error("Showcase contains changes beyond the demo patch; review them manually.");
  }
  let head = oldHead;
  if (oldBase !== base) {
    const temp = mkdtempSync(join(tmpdir(), "diff0-showcase-"));
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(temp, "index") };
      const indexed = (args, input) =>
        execFileSync("git", args, { env, input, encoding: "utf8" }).trim();
      indexed(["read-tree", base]);
      const blob = indexed(["hash-object", "-w", "--stdin"], showcaseInstructions(read(base)));
      indexed(["update-index", "--add", "--cacheinfo", `100644,${blob},${showcasePath}`]);
      const tree = indexed(["write-tree"]);
      head = indexed([
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit-tree",
        tree,
        "-p",
        base,
        "-m",
        "Showcase: summarize directly instead of delegating to reporter",
      ]);
      // Authentication is scoped to this process, never persisted for evaluated code.
      execFileSync(
        "git",
        [
          "push",
          `--force-with-lease=refs/heads/${branch}:${oldHead}`,
          `https://github.com/${repo}.git`,
          `${head}:refs/heads/${branch}`,
        ],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
          },
        },
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  appendFileSync(GITHUB_OUTPUT, `base-sha=${base}\nhead-sha=${head}\n`);
  await upsertComment({
    token,
    repo,
    prNumber: "15",
    body: `${REPORT_MARKER}\n\n## Showcase comparison running\n\nComparing ${base} → ${head}.\n\n[Workflow run](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}). If this run fails or is cancelled before producing a report, this notice remains; no previous result represents these commits.`,
  });
  console.log(`Showcase #15: ${base}...${head}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
