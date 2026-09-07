import { describe, expect, it, vi } from "vitest";
import {
  type ReviewChecks,
  requireReviewChecks,
  reviewCheckPlan,
  runNextReviewCheck,
} from "../agent/lib/github/review-checks.js";
import {
  enforceStationRetries,
  recordStationResult,
  type StationRetries,
} from "../agent/lib/station-retries.js";

const initial = (): StationRetries => ({ turnId: "", seen: [], failures: {} });

describe("station retry limit", () => {
  it("stops after the second failure, before a third attempt", () => {
    let state = initial();
    const dispatch = vi.fn();
    expect(() => {
      for (let attempt = 0; attempt < 3; attempt++) {
        dispatch();
        state = recordStationResult(state, "turn", `call-${attempt}`, "analyst", true);
        enforceStationRetries(state);
      }
    }).toThrow("one retry is exhausted");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates replayed results and maintains independent station counters", () => {
    let state = recordStationResult(initial(), "turn", "call-1", "analyst", true);
    state = recordStationResult(state, "turn", "call-1", "analyst", true);
    state = recordStationResult(state, "turn", "call-2", "reviewer", true);
    expect(() => enforceStationRetries(state)).not.toThrow();
    expect(state.failures).toEqual({ analyst: 1, reviewer: 1 });
  });

  it("allows successful review revisions and resets after success or a new turn", () => {
    let state = recordStationResult(initial(), "turn", "1", "reviewer", true);
    state = recordStationResult(state, "turn", "2", "reviewer", false);
    state = recordStationResult(state, "turn", "3", "reviewer", true);
    expect(() => enforceStationRetries(state)).not.toThrow();
    state = recordStationResult(state, "next-turn", "4", "reviewer", true);
    expect(state.failures.reviewer).toBe(1);
  });
});

function sandbox(fail?: string, changed = "src/report/format.ts") {
  let sha = "b".repeat(40);
  const run = vi.fn(async ({ command }: { command: string }) => ({
    exitCode: fail && command.includes(fail) ? 124 : 0,
    stdout: command.includes("diff --name-only")
      ? changed
      : command.includes("status --porcelain")
        ? ""
        : command.includes("branch --show-current")
          ? `eve/test\n${sha}`
          : "passed",
    stderr: fail && command.includes(fail) ? "prerequisite unavailable" : "",
  }));
  return {
    run,
    target: { branch: "eve/test", sha, baseSha: "a".repeat(40), paths: [changed] },
    moveHead: () => {
      sha = "c".repeat(40);
    },
    readTextFile: vi.fn(async () => JSON.stringify({ sha: "a".repeat(40) })),
  };
}

describe("required review checks", () => {
  it("persists one bounded check per call and refuses incomplete attestation", async () => {
    const vm = sandbox();
    const plan = reviewCheckPlan(vm.target);
    let state: ReviewChecks | null = null;
    for (let i = 0; i < plan.checks.length; i++) {
      expect(() => requireReviewChecks(state, "eve/test", "b".repeat(40), plan)).toThrow(
        "incomplete",
      );
      state = await runNextReviewCheck(vm, "eve/test", state, vm.target);
      expect(state.passed).toHaveLength(i + 1);
      expect(
        vm.run.mock.calls.filter(([input]) => input.command.includes("timeout -k 5 240")),
      ).toHaveLength(i + 1);
    }
    expect(requireReviewChecks(state, "eve/test", "b".repeat(40), plan)).toHaveLength(
      plan.checks.length,
    );
    expect(state?.passed.at(-1)).toContain("--fail-on drift");
    expect(state?.passed.at(-2)).toContain("git diff --exit-code -- action/dist");
    await runNextReviewCheck(vm, "eve/test", state, vm.target);
    expect(
      vm.run.mock.calls.filter(([input]) => input.command.includes("timeout -k 5 240")),
    ).toHaveLength(plan.checks.length);
  });

  it("does not advance a failed check or waive a timed-out comparison", async () => {
    for (const fail of [
      "pnpm exec vitest run src/collect/adapter.integration.test.ts",
      "DIFF0_DEMO_MODEL",
    ]) {
      const vm = sandbox(fail);
      let state: ReviewChecks | null = null;
      const successful = reviewCheckPlan(vm.target).checks.findIndex((command) =>
        command.includes(fail),
      );
      expect(successful).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < successful; i++)
        state = await runNextReviewCheck(vm, "eve/test", state, vm.target);
      await expect(runNextReviewCheck(vm, "eve/test", state, vm.target)).rejects.toThrow(
        "exit 124",
      );
      expect(state?.passed).toHaveLength(successful);
    }
  });

  it("invalidates old results when the commit changes", async () => {
    const vm = sandbox();
    const old = await runNextReviewCheck(vm, "eve/test", null, vm.target);
    vm.moveHead();
    const next = await runNextReviewCheck(vm, "eve/test", old, {
      ...vm.target,
      sha: "c".repeat(40),
    });
    expect(next.sha).not.toBe(old.sha);
    expect(next.passed).toEqual(["pnpm typecheck"]);
  });

  it("rejects stale branch, SHA, base, or incomplete command evidence", async () => {
    const vm = sandbox();
    const plan = reviewCheckPlan(vm.target);
    const state: ReviewChecks = {
      branch: "eve/test",
      sha: "b".repeat(40),
      baseSha: plan.baseSha,
      passed: plan.checks,
    };
    for (const altered of [
      { ...state, branch: "eve/other" },
      { ...state, sha: "c".repeat(40) },
      { ...state, baseSha: "d".repeat(40) },
      { ...state, passed: ["claimed pass"] },
    ]) {
      expect(() => requireReviewChecks(altered, "eve/test", "b".repeat(40), plan)).toThrow(
        "incomplete",
      );
    }
  });

  it("rejects a missing trusted target before running sandbox code", async () => {
    const vm = sandbox();
    await expect(runNextReviewCheck(vm, "eve/test", null, null)).rejects.toThrow(
      "trusted checkout target",
    );
    expect(vm.run).not.toHaveBeenCalled();
  });

  it("cannot remove engine checks by changing the sandbox baseline or reported diff", async () => {
    const vm = sandbox(undefined, "src/engine.ts");
    vm.readTextFile.mockResolvedValue(JSON.stringify({ sha: vm.target.sha }));
    const plan = reviewCheckPlan(vm.target);
    let state: ReviewChecks | null = null;
    for (const _check of plan.checks)
      state = await runNextReviewCheck(vm, "eve/test", state, vm.target);
    expect(state?.passed.at(-1)).toContain("DIFF0_DEMO_MODEL=mock");
    expect(state?.passed.at(-2)).toContain("action:build");
    expect(vm.readTextFile).not.toHaveBeenCalled();
    expect(vm.run.mock.calls.some(([{ command }]) => command.includes("diff --name-only"))).toBe(
      false,
    );
  });

  it("requires fresh checkout when HEAD no longer matches the trusted target", async () => {
    const vm = sandbox();
    vm.moveHead();
    await expect(runNextReviewCheck(vm, "eve/test", null, vm.target)).rejects.toThrow(
      "target changed",
    );
    expect(vm.run.mock.calls.some(([{ command }]) => command.includes("timeout"))).toBe(false);
  });
});

describe("hosted sandbox imports", () => {
  it("does not construct a pruned local backend in production", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("FACTORY_REPO", "knowbody/diff0");
    vi.stubEnv("GITHUB_CONNECTOR", "github/test");
    vi.stubEnv("FACTORY_EVAL_SANDBOX", "");
    const pruned = vi.fn(() => {
      throw new Error("Local backends are pruned");
    });
    vi.doMock("eve/sandbox/just-bash", () => ({ justbash: pruned }));
    try {
      for (const path of [
        "../agent/sandbox.js",
        "../agent/subagents/analyst/sandbox.js",
        "../agent/subagents/implementer/sandbox.js",
        "../agent/subagents/reviewer/sandbox.js",
      ]) {
        expect((await import(path)).default).toBeDefined();
      }
      expect(pruned).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("eve/sandbox/just-bash");
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("still rejects explicitly enabling local eval mode on Vercel", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("FACTORY_REPO", "knowbody/diff0");
    vi.stubEnv("GITHUB_CONNECTOR", "github/test");
    vi.stubEnv("FACTORY_EVAL_SANDBOX", "justbash");
    try {
      await expect(import("../agent/lib/eval-sandbox.js")).rejects.toThrow("must not be enabled");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("bounded GitHub transport", () => {
  it("backs off GETs according to Retry-After without replaying writes", async () => {
    const { githubRequest } = await import("../agent/lib/github/transport.js");
    const read = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"message":"rate limited"}', {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(
      githubRequest("https://api.github.com/test", "GET", "secret", { fetchImpl: read }),
    ).resolves.toEqual({ ok: true });
    expect(read).toHaveBeenCalledTimes(2);
    for (const method of ["POST", "PATCH"] as const) {
      const write = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"message":"busy"}', { status: 503 }));
      await expect(
        githubRequest("https://api.github.com/test", method, "secret", { fetchImpl: write }),
      ).rejects.toThrow("GitHub API 503");
      expect(write).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects long retry delays and caps attempts", async () => {
    const { githubRequest } = await import("../agent/lib/github/transport.js");
    for (const [header, expectedAttempts] of [
      ["600", 1],
      ["0", 3],
    ] as const) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () =>
            new Response('{"message":"busy"}', { status: 429, headers: { "Retry-After": header } }),
        );
      await expect(
        githubRequest("https://api.github.com/test", "GET", "secret", { fetchImpl }),
      ).rejects.toThrow("GitHub API 429");
      expect(fetchImpl).toHaveBeenCalledTimes(expectedAttempts);
    }
  });

  it("applies the request deadline and propagates cancellation during body reads", async () => {
    const { githubRequest } = await import("../agent/lib/github/transport.js");
    // Native AbortSignal.timeout is observable on the request, and caller abort
    // also covers body reads rather than ending the deadline after headers.
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.redirect).toBe("error");
      return new Response(
        new ReadableStream({
          start(stream) {
            options?.signal?.addEventListener("abort", () => stream.error(options.signal?.reason));
          },
        }),
      );
    });
    const pending = githubRequest("https://api.github.com/test", "GET", "secret", {
      fetchImpl,
      signal: controller.signal,
    });
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed successful responses", async () => {
    const { githubRequest } = await import("../agent/lib/github/transport.js");
    await expect(
      githubRequest("https://api.github.com/test", "GET", "secret", {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON")),
      }),
    ).rejects.toThrow("invalid JSON");
  });
});
