import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDiffStat, getEvalHarnessChanges } from "./gitdiff.js";

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
  await mkdir(join(repo, "apps", "agent", "evals"), { recursive: true });
  await writeFile(join(repo, "apps", "agent", "evals", "quality.eval.ts"), "expect(42);\n");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "one"]);
  sha1 = gitIn(repo, ["rev-parse", "HEAD"]).trim();

  // a.txt: replace line 2, add line 4 -> 2 insertions, 1 deletion.
  await writeFile(join(repo, "a.txt"), "one\n2\nthree\nfour\n", "utf8");
  await writeFile(join(repo, "img.bin"), Buffer.from([0x00, 0xaa, 0xbb, 0x00, 0xcc, 0x00]));
  await writeFile(join(repo, "apps", "agent", "evals", "quality.eval.ts"), "expect(43);\n");
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
      { path: "apps/agent/evals/quality.eval.ts", insertions: 1, deletions: 1 },
      { path: "img.bin", insertions: 0, deletions: 0 },
    ]);
    expect(stat?.summary).toBe("3 files changed, 3 insertions(+), 2 deletions(-)");
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

  it("returns null when git cannot inspect the refs", async () => {
    await expect(
      getEvalHarnessChanges(repo, sha1, "0000000000000000000000000000000000000000", "."),
    ).resolves.toBeNull();
  });
});
