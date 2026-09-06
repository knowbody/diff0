import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateReviewedPullRequest } from "../scripts/validate-reviewed-pr.mjs";

const repository = "knowbody/diff0";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const pr = () => ({
  state: "open",
  head: { sha: headSha, repo: { full_name: repository } },
  base: { sha: baseSha, ref: "main", repo: { full_name: repository, default_branch: "main" } },
});

describe("reviewed PR comparison", () => {
  it("accepts an exact reviewed same-repository commit", () => {
    expect(validateReviewedPullRequest(pr(), repository, headSha)).toEqual({ baseSha, headSha });
  });

  it("rejects moving refs, short SHAs, and shell input", () => {
    for (const head of ["main", headSha.slice(0, 8), "$(echo unsafe)", "c".repeat(40)]) {
      expect(() => validateReviewedPullRequest(pr(), repository, head)).toThrow();
    }
  });

  it("rejects fork heads, a different base repository, and closed PRs", () => {
    for (const changed of [
      { ...pr(), head: { sha: headSha, repo: { full_name: "outsider/diff0" } } },
      { ...pr(), base: { sha: baseSha, repo: { full_name: "outsider/diff0" } } },
      { ...pr(), state: "closed" },
      { ...pr(), head: { sha: headSha, repo: null } },
    ]) {
      expect(() => validateReviewedPullRequest(changed, repository, headSha)).toThrow();
    }
  });

  it("refuses a stale report after the PR base moves", () => {
    expect(() => validateReviewedPullRequest(pr(), repository, headSha, "c".repeat(40))).toThrow(
      "base changed",
    );
  });

  it("does not execute an unreviewed base branch", () => {
    expect(() => validateReviewedPullRequest(
      { ...pr(), base: { ...pr().base, ref: "unreviewed-branch" } }, repository, headSha,
    )).toThrow("default branch");
  });

  it("gates paid execution and report publication on separate revision checks", () => {
    const workflow = parse(readFileSync(
      new URL("../.github/workflows/eve-reviewed-diff.yml", import.meta.url), "utf8",
    ));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    const job = workflow.jobs.compare;
    expect(job.if).toContain("github.actor == github.repository_owner");
    expect(job.if).toContain("github.triggering_actor == github.repository_owner");
    expect(job.if).toContain("github.event.repository.default_branch");
    const verify = job.steps.findIndex((step: { id?: string }) => step.id === "refs");
    const compare = job.steps.findIndex((step: { id?: string }) => step.id === "compare");
    expect(verify).toBeLessThan(compare);
    expect(job.steps[verify].env.REVIEWED_SHA).toBe("${{ inputs.reviewed_sha }}");
    expect(Object.keys(job.steps[compare].env)).toEqual(["AI_GATEWAY_API_KEY", "FACTORY_EVAL_SANDBOX"]);
    const publish = job.steps[compare + 1];
    expect(publish.env.REVIEWED_SHA).toBe("${{ inputs.reviewed_sha }}");
    expect(publish.env.EXPECTED_BASE_SHA).toBe("${{ steps.refs.outputs.base-sha }}");
    expect(publish.run.trim().split("\n")).toEqual([
      "node scripts/validate-reviewed-pr.mjs", "node action/upsert-comment.mjs",
    ]);
  });
});
