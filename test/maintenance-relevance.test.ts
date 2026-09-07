import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyChanges, inspectComparison } from "../scripts/maintenance-relevance.mjs";

const manifest = { name: "diff0", dependencies: { eve: "0.47.5", ai: "7.0.85" }, files: ["dist"] };
const before = JSON.stringify(manifest);

describe("maintenance eval relevance", () => {
  it("skips the PR #23 combination of docs plus npm files metadata", () => {
    expect(
      classifyChanges(
        ["README.md", "GETTING_STARTED.md", "package.json"],
        before,
        JSON.stringify({ ...manifest, files: ["dist", "GETTING_STARTED.md"] }),
      ).relevant,
    ).toBe(false);
  });

  it.each([
    { dependencies: { eve: "0.48.0", ai: "7.0.85" } },
    { dependencies: { eve: "0.47.5", ai: "7.0.86" } },
    { devDependencies: { "some-tool-library": "2" } },
    { optionalDependencies: { "some-optional-library": "2" } },
    { peerDependencies: { ai: "8" } },
    { overrides: { "transitive-library": "2" } },
    { pnpm: { overrides: { "transitive-library": "2" } } },
    { resolutions: { "transitive-library": "2" } },
    { scripts: { postinstall: "generate-runtime" } },
    { engines: { node: ">=26" } },
    { packageManager: "pnpm@11.23.0" },
    { imports: { "#tools": "./new-tools.js" } },
    { unknownRuntimeSetting: true },
  ])("runs for runtime/library/configuration changes: %j", (change) => {
    expect(
      classifyChanges(
        ["package.json"],
        before,
        JSON.stringify({ ...manifest, ...change, files: ["dist", "GETTING_STARTED.md"] }),
      ).relevant,
    ).toBe(true);
  });

  it.each([
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "pnpm-workspace.yaml",
    ".npmrc",
    "agent/tools/query.ts",
    "unknown.ts",
  ])("keeps %s relevant even alongside harmless metadata", (path) => {
    expect(classifyChanges([path, "package.json"], before, before).relevant).toBe(true);
  });

  it.each([undefined, "{broken", "null", "[]"])(
    "fails open for unreadable manifests: %s",
    (value) => {
      expect(classifyChanges(["package.json"], before, value).relevant).toBe(true);
    },
  );

  it("ignores property ordering but not removed dependencies", () => {
    expect(
      classifyChanges(
        ["package.json"],
        before,
        JSON.stringify({
          files: ["dist"],
          dependencies: { ai: "7.0.85", eve: "0.47.5" },
          name: "diff0",
        }),
      ).relevant,
    ).toBe(false);
    expect(
      classifyChanges(["package.json"], before, JSON.stringify({ name: "diff0", files: ["dist"] }))
        .relevant,
    ).toBe(true);
  });

  // This exercises real Git through several subprocesses, including three commits.
  // Allow contention from parallel suite/integration installs without weakening assertions.
  it("reads committed refs and treats a lockfile-only upgrade as relevant", {
    timeout: 20_000,
  }, () => {
    const repo = mkdtempSync(join(tmpdir(), "diff0-relevance-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    try {
      git("init", "-q");
      writeFileSync(join(repo, "package.json"), before);
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      writeFileSync(
        join(repo, "package.json"),
        JSON.stringify({ ...manifest, files: ["dist", "guide.md"] }),
      );
      git("add", ".");
      git("commit", "-qm", "metadata");
      const metadata = git("rev-parse", "HEAD");
      // Uncommitted edits must not change the committed comparison.
      writeFileSync(join(repo, "package.json"), "invalid");
      expect(inspectComparison(repo, base, metadata).relevant).toBe(false);
      git("restore", "package.json");
      writeFileSync(join(repo, "pnpm-lock.yaml"), "transitive-library: 2\n");
      git("add", ".");
      git("commit", "-qm", "transitive upgrade");
      expect(inspectComparison(repo, base, git("rev-parse", "HEAD")).relevant).toBe(true);
      expect(inspectComparison(repo, base, "f".repeat(40)).relevant).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
