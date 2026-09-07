import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { showcaseInstructions, showcasePath } from "../scripts/refresh-showcase.mjs";

describe("showcase refresh", () => {
  it("rebases the exact patch without touching the checkout and refuses unrelated branch edits", () => {
    const root = mkdtempSync(join(tmpdir(), "diff0-refresh-test-"));
    try {
      const remote = join(root, "remote.git");
      const cwd = join(root, "repo");
      execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
      execFileSync("git", ["init", "-b", "main", cwd], { stdio: "pipe" });
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      git("config", `url.${remote}.insteadOf`, "https://github.com/knowbody/diff0.git");
      git("remote", "add", "origin", remote);
      const source = readFileSync(new URL(`../${showcasePath}`, import.meta.url), "utf8");
      mkdirSync(join(cwd, "fixtures/demo-agent/agent"), { recursive: true });
      writeFileSync(join(cwd, showcasePath), source);
      git("add", ".");
      git("commit", "-m", "base");
      git("checkout", "-b", "showcase/live-proof-v3");
      writeFileSync(join(cwd, showcasePath), showcaseInstructions(source));
      git("commit", "-am", "demo patch");
      git("push", "origin", "showcase/live-proof-v3");
      git("checkout", "main");
      writeFileSync(join(cwd, "README.md"), "New release\n");
      git("add", ".");
      git("commit", "-m", "release");
      git("push", "origin", "main");
      const base = git("rev-parse", "HEAD");
      const preload = join(root, "github.mjs");
      writeFileSync(
        preload,
        `
        import { execFileSync } from 'node:child_process';
        globalThis.fetch = async (url, options) => {
          const repo = { full_name: 'knowbody/diff0' };
          const head = execFileSync('git', ['rev-parse', 'origin/showcase/live-proof-v3'], {encoding:'utf8'}).trim();
          const body = String(url).endsWith('/pulls/15')
            ? {state:'open', draft:true, head:{repo, ref:'showcase/live-proof-v3', sha:head}, base:{repo, ref:'main'}}
            : options?.method === 'PATCH' ? {id:1} : [{id:1, body:'<!-- diff0-report -->'}];
          return new Response(JSON.stringify(body), {status:200});
        };
      `,
      );
      const output = join(root, "outputs");
      const run = () =>
        execFileSync(
          process.execPath,
          [
            "--import",
            preload,
            fileURLToPath(new URL("../scripts/refresh-showcase.mjs", import.meta.url)),
          ],
          {
            cwd,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              GH_TOKEN: "test-token",
              GITHUB_REPOSITORY: "knowbody/diff0",
              GITHUB_OUTPUT: output,
              GITHUB_RUN_ID: "1",
            },
          },
        );
      run();
      git("fetch", "origin");
      const head = git("rev-parse", "origin/showcase/live-proof-v3");
      expect(git("rev-parse", `${head}^`)).toBe(base);
      expect(git("diff", "--name-only", base, head)).toBe(showcasePath);
      expect(git("status", "--porcelain")).toBe("");
      expect(git("rev-parse", "HEAD")).toBe(base);
      expect(readFileSync(output, "utf8")).toContain(`head-sha=${head}`);
      run();
      expect(git("rev-parse", "origin/showcase/live-proof-v3")).toBe(head);
      git("checkout", "-B", "showcase/live-proof-v3", head);
      writeFileSync(join(cwd, "unexpected.txt"), "preserve me\n");
      git("add", ".");
      git("commit", "-m", "unrelated work");
      git("push", "origin", "showcase/live-proof-v3");
      git("checkout", "main");
      expect(run).toThrow("Showcase contains changes beyond the demo patch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves the demo contract and changes only the delegation rule", () => {
    const source = readFileSync(new URL(`../${showcasePath}`, import.meta.url), "utf8");
    const changed = showcaseInstructions(source);
    expect(changed).toContain("give a one-line executive summary before replying.");
    expect(changed).not.toContain("`reporter` subagent");
    expect(
      changed.replace(
        "- After computing a figure, give a one-line executive summary before replying.",
        "- After computing a figure, delegate a one-line executive summary to the\n  `reporter` subagent before replying.",
      ),
    ).toBe(source);
    expect(() => showcaseInstructions(changed)).toThrow("delegation rule changed");
    expect(() => showcaseInstructions(source + source)).toThrow("delegation rule changed");
  });

  it("refreshes from trusted main and explicitly publishes a checked comparison", () => {
    const workflow = parse(
      readFileSync(new URL("../.github/workflows/showcase.yml", import.meta.url), "utf8"),
    );
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.pull_request_target).toBeUndefined();
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    const job = workflow.jobs.refresh;
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    const checkout = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout.with["persist-credentials"]).toBe(false);
    const compare = job.steps.find((step: { id?: string }) => step.id === "compare");
    expect(Object.keys(compare.env).filter((key) => /TOKEN|KEY/.test(key))).toEqual([
      "AI_GATEWAY_API_KEY",
    ]);
    expect(compare.with.runs).toBe("10");
    expect(compare.with["max-spend"]).toBe("0.30");
    const publish = job.steps.find((step: { run?: string }) =>
      step.run?.includes("upsert-comment.mjs"),
    );
    expect(publish.run).toBe(
      "node scripts/validate-reviewed-pr.mjs\nnode action/upsert-comment.mjs\n",
    );
    expect(publish.env.PR_NUMBER).toBe("15");
    expect(publish.env.EXPECTED_BASE_SHA).toBe(compare.with.base);
    expect(publish.env.REVIEWED_SHA).toBe(compare.with.head);
  });
});
