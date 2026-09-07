import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** Independent scratch Git state keeps each hosted verification command replayable. */
export async function calibrationRepository() {
  const repo = await mkdtemp(join(tmpdir(), "diff0-calibration-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

  try {
    await cp(new URL("../../fixtures/calibration-agent", import.meta.url), repo, {
      recursive: true,
      filter: (source) => !["node_modules", ".eve"].includes(basename(source)),
    });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "control");
    const base = git("rev-parse", "HEAD");
    const options = {
      repoPath: repo,
      baseRef: base,
      headRef: base,
      appDir: ".",
      evalFilter: [],
      runs: 3,
      noCache: true,
      maxConcurrency: 1,
      timeoutMs: 60_000,
      installMode: "scripts-off" as const,
    };

    return { repo, git, options, cleanup: () => rm(repo, { recursive: true, force: true }) };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}
