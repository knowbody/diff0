import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { buildRuns } from "./helpers/records.js";

it("compiles and runs a consumer with only the installed tarball and declared dependencies", () => {
  const root = resolve(import.meta.dirname, "..");
  const scratch = mkdtempSync(join(tmpdir(), "diff0-consumer-"));
  const run = (command: string, args: string[], cwd = scratch) =>
    execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90_000,
      env: { ...process.env, NODE_PATH: "" },
    });
  try {
    // test:package builds once before starting Vitest. No test worker mutates dist.
    const artifact = { filename: "diff0.tgz" };
    run("pnpm", ["pack", "--out", join(scratch, artifact.filename)], root);
    cpSync(join(root, "test", "fixtures", "library-consumer"), scratch, { recursive: true });
    const version = (name: string): string =>
      JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@knowbody/diff0": `file:./${artifact.filename}` },
        devDependencies: {
          typescript: version("typescript"),
          "@types/node": version("@types/node"),
        },
      }),
    );
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
    const installed = JSON.parse(
      readFileSync(join(scratch, "node_modules", "@knowbody", "diff0", "package.json"), "utf8"),
    );
    expect(installed.dependencies).not.toHaveProperty("eve");
    expect(installed.engines.node).toBe(">=20");
    expect(existsSync(join(scratch, "node_modules", "eve"))).toBe(false);
    expect(existsSync(join(scratch, "node_modules", "@knowbody", "diff0", "agent"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies.eve).toBe(
      "0.52.2",
    );
    const records = (ref: string, sha: string, hash: string) =>
      buildRuns(
        ref,
        sha,
        Array.from({ length: 3 }, () => ({
          evals: { smoke: true },
          toolInputs: [{ name: "lookup", inputsHash: hash, evalName: "smoke" }],
        })),
      );
    writeFileSync(
      join(scratch, "records.json"),
      JSON.stringify({
        base: records("main", "aaa1111", "private-base"),
        head: records("topic", "bbb2222", "private-head"),
      }),
    );
    run(join(scratch, "node_modules", ".bin", "tsc"), ["--project", "tsconfig.json"]);
    const result = run(process.execPath, ["consumer.mjs"]);
    expect(JSON.parse(result)).toEqual({ verdict: "yellow", schemaVersion: 5 });
    expect(
      readFileSync(
        join(scratch, "node_modules", "@knowbody", "diff0", "docs", "library-api.md"),
        "utf8",
      ),
    ).toContain("compareRefs");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
