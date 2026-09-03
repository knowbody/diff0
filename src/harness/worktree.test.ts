import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorktree,
  installDependencies,
  installWorktreeDependencies,
  normalizeAppDirectory,
  resolveRef,
  sanitizeInstallEnvironment,
} from "./worktree.js";

function gitIn(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=diff0-test", "-c", "user.email=test@diff0.invalid", ...args],
    { encoding: "utf8" },
  );
}

let scratch: string;
let repo: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "diff0-wt-test-"));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });
  writeFileSync(join(repo, "README.md"), "hello\n");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-q", "-m", "initial"]);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("resolveRef", () => {
  it("resolves a branch to a full SHA", async () => {
    const sha = await resolveRef(repo, "main");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rejects with a clear error for an unknown ref", async () => {
    await expect(resolveRef(repo, "does-not-exist")).rejects.toThrow(
      /Ref "does-not-exist" was not found/,
    );
  });

  it("rejects with a clear error for a non-git directory", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "diff0-notgit-"));
    try {
      await expect(resolveRef(notARepo, "main")).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it("rejects a dirty literal HEAD so uncommitted work cannot be reported as tested", async () => {
    await writeFile(join(repo, "README.md"), "uncommitted\n", "utf8");
    try {
      await expect(resolveRef(repo, "HEAD")).rejects.toThrow(
        /working tree has uncommitted changes.*would be excluded/s,
      );
      await expect(resolveRef(repo, "main")).resolves.toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await writeFile(join(repo, "README.md"), "hello\n", "utf8");
    }
  });
});

describe("normalizeAppDirectory", () => {
  it("normalizes paths within the checkout", () => {
    expect(normalizeAppDirectory("./apps/agent")).toBe(join("apps", "agent"));
    expect(normalizeAppDirectory(" ")).toBe(".");
  });

  it("rejects absolute paths and parent traversal", () => {
    expect(() => normalizeAppDirectory("../outside")).toThrow(/must stay within/);
    expect(() => normalizeAppDirectory("apps/../../outside")).toThrow(/must stay within/);
    expect(() => normalizeAppDirectory(join(scratch, "outside"))).toThrow(/must stay within/);
  });
});

describe("createWorktree", () => {
  it("rejects for a non-git directory", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "diff0-notgit-"));
    try {
      await expect(createWorktree(notARepo, "main")).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it("rejects for an unknown ref", async () => {
    await expect(createWorktree(repo, "no-such-ref")).rejects.toThrow(/was not found/);
  });

  it("creates a detached worktree and cleans it up", async () => {
    const handle = await createWorktree(repo, "main");
    try {
      expect(handle.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(join(handle.path, "README.md"))).toBe(true);
      // No package.json in this repo -> install step is a no-op.
      expect(existsSync(join(handle.path, "node_modules"))).toBe(false);
    } finally {
      await handle.cleanup();
    }
    expect(existsSync(handle.path)).toBe(false);
    // The worktree is gone from git's metadata too.
    const list = gitIn(repo, ["worktree", "list", "--porcelain"]);
    expect(list).not.toContain(handle.path);
  });

  it("uses an already-resolved immutable commit without resolving the ref again", async () => {
    const commitSha = await resolveRef(repo, "main");
    const handle = await createWorktree(repo, "ref-that-no-longer-exists", {
      install: false,
      resolvedCommitSha: commitSha,
    });
    try {
      expect(handle.commitSha).toBe(commitSha);
    } finally {
      await handle.cleanup();
    }
  });
});

describe("dependency install hardening", () => {
  it("removes credential-shaped values from the install environment", () => {
    expect(
      sanitizeInstallEnvironment({
        PATH: "/bin",
        SAFE_SETTING: "kept",
        NODE_AUTH_TOKEN: "registry-token",
        OPENAI_API_KEY: "secret",
        GITHUB_TOKEN: "secret",
        AWS_SESSION_TOKEN: "secret",
        DATABASE_URL: "postgres://user:pass@example/db",
        NPM_CONFIG_ALWAYS_AUTH: "true",
      }),
    ).toEqual({ PATH: "/bin", SAFE_SETTING: "kept", NODE_AUTH_TOKEN: "registry-token" });
  });

  it("refuses installs without exactly one committed lockfile", async () => {
    const app = join(scratch, "unlocked-app");
    await mkdir(app);
    await writeFile(join(app, "package.json"), '{"name":"unlocked"}\n', "utf8");
    await expect(installDependencies(app)).rejects.toThrow(/no supported lockfile was committed/);

    await writeFile(join(app, "package-lock.json"), "{}\n", "utf8");
    await writeFile(join(app, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await expect(installDependencies(app)).rejects.toThrow(/multiple lockfiles found/);
  });

  it("uses npm ci once, with secrets scrubbed and an isolated home", async () => {
    const app = join(scratch, "locked-app");
    const fakeBin = join(scratch, "fake-bin");
    const log = join(scratch, "install-log.json");
    await mkdir(app);
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"locked"}\n', "utf8");
    await writeFile(join(app, "package-lock.json"), "{}\n", "utf8");
    const npm = join(fakeBin, "npm");
    writeFileSync(
      npm,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.DIFF0_TEST_INSTALL_LOG, JSON.stringify({args: process.argv.slice(2), secret: process.env.OPENAI_API_KEY, home: process.env.HOME, userconfig: process.env.NPM_CONFIG_USERCONFIG}));\n`,
    );
    chmodSync(npm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    const oldSecret = process.env.OPENAI_API_KEY;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    process.env.OPENAI_API_KEY = "must-not-leak";
    try {
      await installDependencies(app);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
      if (oldSecret === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldSecret;
    }

    const captured = JSON.parse(await readFile(log, "utf8")) as {
      args: string[];
      secret?: string;
      home: string;
      userconfig: string;
    };
    expect(captured.args).toEqual(["ci", "--ignore-scripts"]);
    expect(captured.secret).toBeUndefined();
    expect(captured.home).toContain("diff0-install-home-");
    expect(captured.userconfig).toBe(join(captured.home, ".npmrc"));
    expect(existsSync(captured.home)).toBe(false);
  });

  it("uses frozen scripts-off commands for pnpm, Yarn Classic/Berry, and Bun", async () => {
    const fakeBin = join(scratch, "portable-package-manager-bin");
    const log = join(scratch, "portable-package-manager-log.jsonl");
    await mkdir(fakeBin);
    const recorder =
      '#!/usr/bin/env node\nconst fs=require("node:fs"); const path=require("node:path"); ' +
      'fs.appendFileSync(process.env.DIFF0_TEST_INSTALL_LOG, JSON.stringify({bin:path.basename(process.argv[1]),args:process.argv.slice(2)})+"\\n");\n';
    for (const bin of ["pnpm", "yarn", "bun"]) {
      const path = join(fakeBin, bin);
      writeFileSync(path, recorder);
      chmodSync(path, 0o755);
    }

    const cases = [
      {
        name: "pnpm-app",
        packageJson: { name: "pnpm-app", packageManager: "pnpm@10.15.1" },
        lockfile: "pnpm-lock.yaml",
      },
      {
        name: "yarn-classic-app",
        packageJson: { name: "yarn-classic-app", packageManager: "yarn@1.22.22" },
        lockfile: "yarn.lock",
      },
      {
        name: "yarn-berry-app",
        packageJson: { name: "yarn-berry-app", packageManager: "yarn@4.9.2" },
        lockfile: "yarn.lock",
      },
      {
        name: "bun-app",
        packageJson: { name: "bun-app", packageManager: "bun@1.2.0" },
        lockfile: "bun.lockb",
      },
    ] as const;
    for (const entry of cases) {
      const app = join(scratch, entry.name);
      await mkdir(app);
      await writeFile(join(app, "package.json"), `${JSON.stringify(entry.packageJson)}\n`, "utf8");
      await writeFile(join(app, entry.lockfile), "", "utf8");
    }

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    try {
      for (const entry of cases) {
        await installDependencies(join(scratch, entry.name));
      }
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
    }

    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { bin: string; args: string[] });
    expect(calls).toEqual([
      {
        bin: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
      },
      { bin: "yarn", args: ["install", "--frozen-lockfile", "--ignore-scripts"] },
      { bin: "yarn", args: ["install", "--immutable", "--mode=skip-builds"] },
      { bin: "bun", args: ["install", "--frozen-lockfile", "--ignore-scripts"] },
    ]);
  });

  it("scripts-on mode enables lifecycle scripts but still scrubs credential-shaped values", async () => {
    const app = join(scratch, "trusted-install-app");
    const fakeBin = join(scratch, "trusted-install-bin");
    const log = join(scratch, "trusted-install-log.json");
    await mkdir(app);
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"scripts-on"}\n', "utf8");
    await writeFile(join(app, "package-lock.json"), "{}\n", "utf8");
    const npm = join(fakeBin, "npm");
    writeFileSync(
      npm,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.DIFF0_TEST_INSTALL_LOG, JSON.stringify({args: process.argv.slice(2), secret: process.env.OPENAI_API_KEY}));\n`,
    );
    chmodSync(npm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    const oldSecret = process.env.OPENAI_API_KEY;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    process.env.OPENAI_API_KEY = "must-not-leak";
    try {
      await installDependencies(app, "scripts-on");
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
      if (oldSecret === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldSecret;
    }

    const captured = JSON.parse(await readFile(log, "utf8")) as {
      args: string[];
      secret?: string;
    };
    expect(captured.args).toEqual(["ci"]);
    expect(captured.secret).toBeUndefined();
  });

  it("does not fall back to npm install when npm ci fails", async () => {
    const app = join(scratch, "broken-lock-app");
    const fakeBin = join(scratch, "failing-bin");
    const log = join(scratch, "failed-install-log.txt");
    await mkdir(app);
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"broken"}\n', "utf8");
    await writeFile(join(app, "package-lock.json"), "{}\n", "utf8");
    const npm = join(fakeBin, "npm");
    writeFileSync(
      npm,
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.DIFF0_TEST_INSTALL_LOG, process.argv.slice(2).join(" ") + "\\n"); process.stderr.write("lock mismatch\\n"); process.exit(7);\n`,
    );
    chmodSync(npm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    try {
      await expect(installDependencies(app)).rejects.toThrow(
        /lock mismatch[\s\S]*will not fall back to a non-frozen install/,
      );
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
    }
    expect(await readFile(log, "utf8")).toBe("ci --ignore-scripts\n");
  });

  it("installs a root workspace once when a nested app has no local lockfile", async () => {
    const app = join(scratch, "monorepo-app");
    const nested = join(app, "apps", "agent");
    const fakeBin = join(scratch, "monorepo-bin");
    const log = join(scratch, "monorepo-install-log.txt");
    await mkdir(nested, { recursive: true });
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"root","workspaces":["apps/*"]}\n', "utf8");
    await writeFile(join(app, "package-lock.json"), "{}\n", "utf8");
    await writeFile(join(nested, "package.json"), '{"name":"agent"}\n', "utf8");
    const npm = join(fakeBin, "npm");
    writeFileSync(
      npm,
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.DIFF0_TEST_INSTALL_LOG, process.cwd() + " " + process.argv.slice(2).join(" ") + "\\n");\n`,
    );
    chmodSync(npm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    try {
      await installWorktreeDependencies(app, ["apps/agent"]);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
    }
    expect(await readFile(log, "utf8")).toBe(`${await realpath(app)} ci --ignore-scripts\n`);
  });

  it("accepts YAML aliases and brace globs in the authoritative pnpm workspace", async () => {
    const app = join(scratch, "pnpm-brace-workspace");
    const nested = join(app, "apps", "api");
    const fakeBin = join(scratch, "pnpm-brace-bin");
    const log = join(scratch, "pnpm-brace-log.txt");
    await mkdir(nested, { recursive: true });
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"root"}\n');
    await writeFile(join(app, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(app, "pnpm-workspace.yaml"),
      'workspace_groups: &members\n  - "apps/{api,web}"\npackages: *members\n',
    );
    await writeFile(join(nested, "package.json"), '{"name":"api"}\n');
    const pnpm = join(fakeBin, "pnpm");
    writeFileSync(
      pnpm,
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.DIFF0_TEST_INSTALL_LOG, process.cwd() + " " + process.argv.slice(2).join(" ") + "\\n");\n`,
    );
    chmodSync(pnpm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    try {
      await installWorktreeDependencies(app, ["apps/api"]);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
    }
    expect(await readFile(log, "utf8")).toContain(
      "install --frozen-lockfile --prefer-offline --ignore-scripts",
    );
  });

  it("uses pnpm-workspace.yaml instead of stale package.json workspaces", async () => {
    const app = join(scratch, "pnpm-authoritative-workspace");
    const nested = join(app, "apps", "agent");
    await mkdir(nested, { recursive: true });
    await writeFile(join(app, "package.json"), '{"name":"root","workspaces":["apps/*"]}\n');
    await writeFile(join(app, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(app, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    await writeFile(join(nested, "package.json"), '{"name":"agent"}\n');

    await expect(installWorktreeDependencies(app, ["apps/agent"])).rejects.toThrow(
      /not declared in the locked root workspace/,
    );
  });

  it("rejects a lockless nested package outside the locked root workspace", async () => {
    const app = join(scratch, "non-workspace-nested-app");
    const nested = join(app, "standalone");
    await mkdir(nested, { recursive: true });
    await writeFile(join(app, "package.json"), '{"name":"root","workspaces":["apps/*"]}\n');
    await writeFile(join(app, "package-lock.json"), "{}\n");
    await writeFile(join(nested, "package.json"), '{"name":"standalone"}\n');

    await expect(installWorktreeDependencies(app, ["standalone"])).rejects.toThrow(
      /not declared in the locked root workspace/,
    );
  });

  it("installs an independently locked nested app when an unrelated root package is unlocked", async () => {
    const app = join(scratch, "independent-nested-app");
    const nested = join(app, "app");
    const fakeBin = join(scratch, "independent-nested-bin");
    const log = join(scratch, "independent-nested-log.txt");
    await mkdir(nested, { recursive: true });
    await mkdir(fakeBin);
    await writeFile(join(app, "package.json"), '{"name":"unrelated-root"}\n', "utf8");
    await writeFile(join(nested, "package.json"), '{"name":"selected-app"}\n', "utf8");
    await writeFile(join(nested, "package-lock.json"), "{}\n", "utf8");
    const npm = join(fakeBin, "npm");
    writeFileSync(
      npm,
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.DIFF0_TEST_INSTALL_LOG, process.cwd() + "\\n");\n`,
    );
    chmodSync(npm, 0o755);

    const oldPath = process.env.PATH;
    const oldLog = process.env.DIFF0_TEST_INSTALL_LOG;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.DIFF0_TEST_INSTALL_LOG = log;
    try {
      await installWorktreeDependencies(app, ["app"]);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.DIFF0_TEST_INSTALL_LOG;
      else process.env.DIFF0_TEST_INSTALL_LOG = oldLog;
    }
    expect(await readFile(log, "utf8")).toBe(`${await realpath(nested)}\n`);
  });

  it("rejects a selected app symlink that escapes the worktree", async () => {
    const app = join(scratch, "symlink-worktree");
    const outside = join(scratch, "symlink-outside");
    await mkdir(app);
    await mkdir(outside);
    await symlink(outside, join(app, "escaped"));
    await expect(installWorktreeDependencies(app, ["escaped"])).rejects.toThrow(
      /must stay within the target repository/,
    );
  });
});
