/**
 * Preflight for this repository's source-based maintenance-agent evals.
 * Package metadata does not enter these evals; dependencies, overrides, scripts,
 * engines, packageManager, unknown keys, and every lockfile remain relevant.
 * This is deliberately not a general rule for apps that evaluate npm tarballs.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const METADATA = new Set([
  "description",
  "keywords",
  "homepage",
  "bugs",
  "repository",
  "author",
  "contributors",
  "funding",
  "license",
  "files",
]);
const isDocumentation = (path) =>
  ["README.md", "GETTING_STARTED.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE"].includes(path) ||
  path.startsWith("docs/");

function runtimeManifest(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid package manifest");
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !METADATA.has(key)));
}

export function classifyChanges(paths, basePackage, headPackage) {
  if (paths.some((path) => path !== "package.json" && !isDocumentation(path))) {
    return {
      relevant: true,
      reason: "Runtime, dependency, configuration, or unclassified files changed.",
    };
  }
  if (paths.includes("package.json")) {
    try {
      if (!isDeepStrictEqual(runtimeManifest(basePackage), runtimeManifest(headPackage))) {
        return { relevant: true, reason: "Runtime or unclassified package.json fields changed." };
      }
    } catch {
      return {
        relevant: true,
        reason: "Could not compare package.json safely; running conservatively.",
      };
    }
  }
  return {
    relevant: false,
    reason: "Only documentation or known non-runtime package metadata changed.",
  };
}

export function inspectComparison(repo, base, head) {
  try {
    if (![base, head].every((ref) => typeof ref === "string" && /^[a-f0-9]{40}$/i.test(ref))) {
      throw new Error("Expected immutable commit SHAs");
    }
    const git = (args) =>
      execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    // No rename detection: moving runtime code into docs must expose its old path too.
    const paths = git(["diff", "--no-renames", "--name-only", "-z", base, head, "--"])
      .split("\0")
      .filter(Boolean);
    return classifyChanges(
      paths,
      paths.includes("package.json") ? git(["show", `${base}:package.json`]) : undefined,
      paths.includes("package.json") ? git(["show", `${head}:package.json`]) : undefined,
    );
  } catch {
    return {
      relevant: true,
      reason: "Preflight could not establish relevance; running conservatively.",
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = inspectComparison(process.cwd(), process.env.BASE_SHA, process.env.HEAD_SHA);
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `relevant=${result.relevant}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Maintenance-agent comparison\n\n${result.relevant ? "Run" : "Skip"}: ${result.reason}\n`,
    );
  }
}
