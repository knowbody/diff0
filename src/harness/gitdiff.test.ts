import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDiffStat } from "./gitdiff.js";

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
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "one"]);
  sha1 = gitIn(repo, ["rev-parse", "HEAD"]).trim();

  // a.txt: replace line 2, add line 4 -> 2 insertions, 1 deletion.
  await writeFile(join(repo, "a.txt"), "one\n2\nthree\nfour\n", "utf8");
  await writeFile(join(repo, "img.bin"), Buffer.from([0x00, 0xaa, 0xbb, 0x00, 0xcc, 0x00]));
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
      { path: "img.bin", insertions: 0, deletions: 0 },
    ]);
    expect(stat?.summary).toBe("2 files changed, 2 insertions(+), 1 deletion(-)");
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
