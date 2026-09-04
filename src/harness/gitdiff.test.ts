import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDiffStat,
  getEvalHarnessChanges,
  getSandboxConfigChanges,
  normalizeValidityPattern,
} from "./gitdiff.js";

function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@test.invalid", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

let scratch: string;
let repo: string;
let sha1: string;
let sha2: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "diff0-gitdiff-"));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });

  await writeFile(join(repo, "a.txt"), "one\ntwo\nthree\n", "utf8");
  await writeFile(join(repo, "img.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x7f]));
  await mkdir(join(repo, "agent"), { recursive: true });
  await mkdir(join(repo, "apps", "agent", "evals"), { recursive: true });
  await mkdir(join(repo, "apps", "agent", "agent"), { recursive: true });
  await mkdir(join(repo, "packages", "eval-utils"), { recursive: true });
  await writeFile(join(repo, "apps", "agent", "evals", "quality.eval.ts"), "expect(42);\n");
  await writeFile(join(repo, "apps", "agent", "agent", "sandbox.ts"), "use(defaults);\n");
  await writeFile(join(repo, "packages", "eval-utils", "scorer.ts"), "export const score = 1;\n");
  await writeFile(join(repo, "agent", "sandbox.ts"), "use(defaults);\n");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "one"]);
  sha1 = gitIn(repo, ["rev-parse", "HEAD"]).trim();

  // a.txt: replace line 2, add line 4 -> 2 insertions, 1 deletion.
  await writeFile(join(repo, "a.txt"), "one\n2\nthree\nfour\n", "utf8");
  await writeFile(join(repo, "img.bin"), Buffer.from([0x00, 0xaa, 0xbb, 0x00, 0xcc, 0x00]));
  await writeFile(join(repo, "apps", "agent", "evals", "quality.eval.ts"), "expect(43);\n");
  await writeFile(join(repo, "apps", "agent", "agent", "sandbox.ts"), "use(vercel);\n");
  await writeFile(join(repo, "packages", "eval-utils", "scorer.ts"), "export const score = 2;\n");
  await writeFile(join(repo, "agent", "sandbox.ts"), "use(vercel);\n");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "two"]);
  sha2 = gitIn(repo, ["rev-parse", "HEAD"]).trim();
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("getDiffStat", () => {
  it("parses numstat lines including binary '-' markers as 0/0", async () => {
    const stat = await getDiffStat(repo, sha1, sha2);
    expect(stat).not.toBeNull();
    expect(stat?.files).toEqual([
      { path: "a.txt", insertions: 2, deletions: 1 },
      { path: "agent/sandbox.ts", insertions: 1, deletions: 1 },
      { path: "apps/agent/agent/sandbox.ts", insertions: 1, deletions: 1 },
      { path: "apps/agent/evals/quality.eval.ts", insertions: 1, deletions: 1 },
      { path: "img.bin", insertions: 0, deletions: 0 },
      { path: "packages/eval-utils/scorer.ts", insertions: 1, deletions: 1 },
    ]);
    expect(stat?.summary).toBe("6 files changed, 6 insertions(+), 5 deletions(-)");
  });

  it("returns an empty stat for identical shas", async () => {
    const stat = await getDiffStat(repo, sha1, sha1);
    expect(stat).toEqual({ files: [], summary: "0 files changed" });
  });

  it("returns null on an unknown sha", async () => {
    expect(await getDiffStat(repo, sha1, "0000000000000000000000000000000000000000")).toBeNull();
  });

  it("returns null outside a git repository", async () => {
    expect(await getDiffStat(scratch, sha1, sha2)).toBeNull();
  });
});

describe("getEvalHarnessChanges", () => {
  it("finds evaluator changes under the selected app directory only", async () => {
    await expect(getEvalHarnessChanges(repo, sha1, sha2, "apps/agent")).resolves.toEqual([
      "apps/agent/evals/quality.eval.ts",
    ]);
    await expect(getEvalHarnessChanges(repo, sha1, sha2, ".")).resolves.toEqual([]);
  });

  it("adds caller-provided repo-relative validity globs for shared evaluator helpers", async () => {
    await expect(
      getEvalHarnessChanges(repo, sha1, sha2, "apps/agent", ["packages/eval-utils/**"]),
    ).resolves.toEqual(["apps/agent/evals/quality.eval.ts", "packages/eval-utils/scorer.ts"]);
  });

  it("ignores unrelated changed files that match neither the default nor custom globs", async () => {
    await expect(getEvalHarnessChanges(repo, sha1, sha2, "apps/agent")).resolves.not.toContain(
      "a.txt",
    );
  });

  it("rejects absolute, traversing, empty, and negated validity globs", () => {
    expect(() => normalizeValidityPattern("/tmp/**")).toThrow(/contained repo-relative/);
    expect(() => normalizeValidityPattern("../shared/**")).toThrow(/contained repo-relative/);
    expect(() => normalizeValidityPattern("   ")).toThrow(/contained repo-relative/);
    expect(() => normalizeValidityPattern("!evals/**")).toThrow(/contained repo-relative/);
  });

  it("returns null when git cannot inspect the refs", async () => {
    await expect(
      getEvalHarnessChanges(repo, sha1, "0000000000000000000000000000000000000000", "."),
    ).resolves.toBeNull();
  });
});

describe("getSandboxConfigChanges", () => {
  it("finds authored sandbox entry-point changes for a monorepo app", async () => {
    await expect(getSandboxConfigChanges(repo, sha1, sha2, "apps/agent")).resolves.toEqual([
      "apps/agent/agent/sandbox.ts",
    ]);
  });

  it("finds authored sandbox entry-point changes for a root app", async () => {
    await expect(getSandboxConfigChanges(repo, sha1, sha2, ".")).resolves.toEqual([
      "agent/sandbox.ts",
    ]);
  });
});
