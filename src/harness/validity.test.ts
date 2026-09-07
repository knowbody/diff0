import { describe, expect, it } from "vitest";
import { fakeWorktrees, harnessRecord } from "../../test/helpers/harness.js";
import { compareRefs } from "../runner.js";
import type { HarnessDependencies } from "./dependencies.js";

const options = {
  repoPath: "/fake",
  appDir: ".",
  baseRef: "base",
  headRef: "head",
  runs: 3,
  evalFilter: [],
};
function dependencies(): Partial<HarnessDependencies> {
  return {
    adapter: {
      probe: async () => ({ eveVersion: "v", evalIds: ["e/one"], agentInfo: null }),
      runEvalSuite: async (ref, sha, options) => harnessRecord(ref, sha, options.runIndex),
    },
    createWorktree: fakeWorktrees("a").factory,
    resolveRef: async () => "a",
    inferSandbox: async () => ({ backend: "docker", inferred: true }),
    getEvalHarnessChanges: async () => [],
    getSandboxConfigChanges: async () => [],
  };
}
describe("required comparison validity", () => {
  it.each(["getEvalHarnessChanges", "getSandboxConfigChanges"] as const)(
    "prevents green when %s is unavailable",
    async (name) => {
      const report = await compareRefs({
        ...options,
        dependencies: { ...dependencies(), [name]: async () => null },
      });
      expect(report.verdict).toBe("yellow");
      expect(
        report.enforcement.violations.some(
          (violation) => violation.category === "comparison-validity",
        ),
      ).toBe(true);
      expect(report.meta.mismatches.join(" ")).toContain("unavailable");
    },
  );
  it("preserves green for successfully checked unchanged refs", async () => {
    expect((await compareRefs({ ...options, dependencies: dependencies() })).verdict).toBe("green");
  });
  it("uses probe metadata once and reports cleanup failures without losing results", async () => {
    const progress: string[] = [];
    const deps = dependencies();
    deps.getAgentInfo = async () => {
      throw new Error("probe metadata should be reused");
    };
    deps.createWorktree = async () => ({
      path: "/fake",
      commitSha: "a",
      cleanup: async () => {
        throw new Error("cleanup denied");
      },
    });
    const report = await compareRefs({
      ...options,
      dependencies: deps,
      onProgress: (message) => progress.push(message),
    });
    expect(report.verdict).toBe("green");
    expect(progress.filter((message) => message.includes("cleanup denied"))).toHaveLength(2);
  });
  it("preserves an eval failure when cleanup also fails", async () => {
    const deps = dependencies();
    deps.adapter = {
      probe: async () => ({ eveVersion: "v", evalIds: ["e"], agentInfo: null }),
      runEvalSuite: async () => {
        throw new Error("original eval failure");
      },
    };
    deps.createWorktree = async () => ({
      path: "/fake",
      commitSha: "a",
      cleanup: async () => {
        throw new Error("secondary cleanup failure");
      },
    });
    const messages: string[] = [];
    await expect(
      compareRefs({
        ...options,
        dependencies: deps,
        onProgress: (message) => messages.push(message),
      }),
    ).rejects.toThrow("original eval failure");
    expect(messages.some((message) => message.includes("secondary cleanup failure"))).toBe(true);
  });
});
