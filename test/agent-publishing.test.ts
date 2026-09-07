import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGitHubRef: vi.fn(),
  githubApi: vi.fn(),
  fetchFactoryRepositoryMetadata: vi.fn(async () => ({ defaultBranch: "main" })),
  documents: new Map<string, string>(),
  mintInstallationToken: vi.fn(async () => "installation-token"),
}));

vi.mock("../agent/lib/github/api.js", () => ({
  getGitHubRef: mocks.getGitHubRef,
  githubApi: mocks.githubApi,
}));

vi.mock("../agent/lib/github/credentials.js", () => ({
  githubCredentials: {},
}));

vi.mock("../agent/lib/github/git-remote.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/lib/github/git-remote.js")>()),
  mintInstallationToken: mocks.mintInstallationToken,
  fetchFactoryRepositoryMetadata: mocks.fetchFactoryRepositoryMetadata,
}));

vi.mock("../agent/lib/blob.js", () => ({
  ARTIFACTS_PREFIX: "artifacts/",
  readDocument: vi.fn(async (key: string) => {
    const content = mocks.documents.get(key);
    return content === undefined
      ? { found: false }
      : { found: true, content, uploadedAt: "2026-09-07T00:00:00.000Z" };
  }),
  writeDocument: vi.fn(async (key: string, content: string) => {
    mocks.documents.set(key, content);
    return { pathname: key };
  }),
}));

import { readArtifact, saveArtifact } from "../agent/lib/artifacts/tools.js";
import { readDocument, writeDocument } from "../agent/lib/blob.js";
import { createPullRequestPolicy } from "../agent/lib/github/approval.js";
import { attestReviewedCommit } from "../agent/lib/github/attest.js";
import { checkoutOwnedBranch } from "../agent/lib/github/checkout.js";
import {
  type ReviewChecks,
  reviewCheckPlan,
  runNextReviewCheck,
} from "../agent/lib/github/review-checks.js";
import {
  gitBlobSha,
  matchesExistingPublication,
  ownedBranchName,
  publishSandboxCommit,
} from "../agent/lib/github/runtime-push.js";
import { AUTONOMOUS_PRINCIPAL } from "../agent/lib/trust.js";

const BASE_SHA = "a".repeat(40);
const LOCAL_SHA = "b".repeat(40);
const REMOTE_SHA = "c".repeat(40);
const FILE_BYTES = new TextEncoder().encode("hello\n");
const FILE_SHA = gitBlobSha(FILE_BYTES);

function sandbox() {
  const run = vi.fn(async ({ command }: { command: string }) => {
    let stdout = "";
    if (command.includes("rev-parse --verify")) stdout = `${LOCAL_SHA}\n`;
    else if (command.includes("diff --name-only")) stdout = "file.txt\0";
    else if (command.includes("ls-tree"))
      stdout = `100644 blob ${FILE_SHA} ${FILE_BYTES.length}\tfile.txt\0`;
    else if (command.includes("log -1")) stdout = "Fix the thing\n";
    return { exitCode: 0, stderr: "", stdout };
  });
  return {
    run,
    value: {
      readFile: vi.fn(
        async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(FILE_BYTES);
              controller.close();
            },
          }),
      ),
      readTextFile: vi.fn(async () => JSON.stringify({ branch: "main", sha: BASE_SHA })),
      run,
    },
  };
}

function mockGitDataApi(existing?: {
  message: string;
  parents: Array<{ sha: string }>;
  tree: { sha: string };
}) {
  mocks.githubApi.mockImplementation(async (method: string, path: string) => {
    if (method === "GET" && path === "") return { default_branch: "main" };
    if (method === "POST" && path === "/git/blobs") return { sha: FILE_SHA };
    if (method === "GET" && path === `/git/commits/${BASE_SHA}`) {
      return { tree: { sha: "base-tree" } };
    }
    if (method === "POST" && path === "/git/trees") return { sha: "intended-tree" };
    if (method === "GET" && path === `/git/commits/${REMOTE_SHA}` && existing) return existing;
    if (method === "POST" && path === "/git/commits") return { sha: REMOTE_SHA };
    if (method === "POST" && path === "/git/refs") return {};
    throw new Error(`Unexpected API call: ${method} ${path}`);
  });
}

describe("trusted runtime publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
  });

  it("binds every local Git inspection to one resolved immutable SHA", async () => {
    const local = sandbox();
    mockGitDataApi();
    mocks.getGitHubRef
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ object: { sha: BASE_SHA } });

    await publishSandboxCommit({
      requestedBranch: "eve/fix",
      rootSessionId: "root-session",
      sandbox: local.value,
    });

    const commands = local.run.mock.calls.map(([input]) => input.command);
    expect(
      commands.some((command) => command.includes(`diff --name-only -z ${BASE_SHA} ${LOCAL_SHA}`)),
    ).toBe(true);
    expect(commands.some((command) => command.includes(`ls-tree -zl ${LOCAL_SHA}`))).toBe(true);
    expect(commands.some((command) => command.includes(`log -1 --pretty=%B ${LOCAL_SHA}`))).toBe(
      true,
    );
    expect(
      commands.filter((command) => /(?:diff --name-only|ls-tree|log -1).*\bHEAD\b/.test(command)),
    ).toEqual([]);
  });

  it("accepts an exact retry before consulting a moved default branch", async () => {
    const local = sandbox();
    mockGitDataApi({
      message: "Fix the thing",
      parents: [{ sha: BASE_SHA }],
      tree: { sha: "intended-tree" },
    });
    mocks.getGitHubRef.mockResolvedValueOnce({ object: { sha: REMOTE_SHA } });

    await expect(
      publishSandboxCommit({
        requestedBranch: "eve/fix",
        rootSessionId: "root-session",
        sandbox: local.value,
      }),
    ).resolves.toMatchObject({ sha: REMOTE_SHA });

    expect(mocks.getGitHubRef).toHaveBeenCalledTimes(1);
    expect(mocks.githubApi).not.toHaveBeenCalledWith("POST", "/git/commits", expect.anything());
    expect(mocks.githubApi).not.toHaveBeenCalledWith("POST", "/git/refs", expect.anything());
  });

  it.each([
    ["tree", { message: "Fix the thing", parents: [{ sha: BASE_SHA }], tree: { sha: "other" } }],
    ["parent", { message: "Fix the thing", parents: [{ sha: LOCAL_SHA }], tree: { sha: "tree" } }],
    ["message", { message: "Other", parents: [{ sha: BASE_SHA }], tree: { sha: "tree" } }],
    [
      "merge",
      {
        message: "Fix the thing",
        parents: [{ sha: BASE_SHA }, { sha: LOCAL_SHA }],
        tree: { sha: "tree" },
      },
    ],
  ])("rejects a retry with a different %s", (_field, existing) => {
    expect(
      matchesExistingPublication(existing, {
        message: "Fix the thing",
        parentSha: BASE_SHA,
        treeSha: "tree",
      }),
    ).toBe(false);
  });
});

describe("publication byte budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitDataApi();
    mocks.getGitHubRef.mockReset().mockResolvedValue(null);
  });

  it("refuses a committed oversized object before reading its body", async () => {
    const local = sandbox();
    local.run.mockImplementation(async ({ command }) => ({
      exitCode: 0,
      stderr: "",
      stdout: command.includes("rev-parse")
        ? LOCAL_SHA
        : command.includes("diff --name-only")
          ? "file.txt\0"
          : command.includes("ls-tree")
            ? `100644 blob ${FILE_SHA} 4194305\tfile.txt\0`
            : "",
    }));
    await expect(
      publishSandboxCommit({
        requestedBranch: "eve/fix",
        rootSessionId: "root",
        sandbox: local.value,
      }),
    ).rejects.toThrow("per-file limit");
    expect(local.value.readFile).not.toHaveBeenCalled();
    expect(mocks.githubApi.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("stops before the next file would exceed the total budget", async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024);
    const sha = gitBlobSha(bytes);
    const local = sandbox();
    local.run.mockImplementation(async ({ command }) => {
      const path = /-- '(file-\d+)'/.exec(command)?.[1];
      return {
        exitCode: 0,
        stderr: "",
        stdout: command.includes("rev-parse")
          ? LOCAL_SHA
          : command.includes("diff --name-only")
            ? Array.from({ length: 8 }, (_, i) => `file-${i}\0`).join("")
            : path
              ? `100644 blob ${sha} ${bytes.length}\t${path}\0`
              : "",
      };
    });
    local.value.readFile.mockImplementation(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    );
    await expect(
      publishSandboxCommit({
        requestedBranch: "eve/fix",
        rootSessionId: "root",
        sandbox: local.value,
      }),
    ).rejects.toThrow("total limit");
    expect(local.value.readFile).toHaveBeenCalledTimes(6);
    expect(
      local.run.mock.calls.filter(([{ command }]) => command.includes("ls-tree")),
    ).toHaveLength(7);
    expect(mocks.githubApi.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("cancels a working-tree stream that grows beyond its inspected size", async () => {
    const local = sandbox();
    const cancel = vi.fn();
    local.value.readFile.mockImplementation(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(FILE_BYTES.length + 1));
          },
          cancel,
        }),
    );
    await expect(
      publishSandboxCommit({
        requestedBranch: "eve/fix",
        rootSessionId: "root",
        sandbox: local.value,
      }),
    ).rejects.toThrow("working-tree bytes changed");
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.githubApi.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("rejects same-sized changed bytes before publishing any blob", async () => {
    const local = sandbox();
    local.value.readFile.mockImplementation(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(FILE_BYTES.length));
            controller.close();
          },
        }),
    );
    await expect(
      publishSandboxCommit({
        requestedBranch: "eve/fix",
        rootSessionId: "root",
        sandbox: local.value,
      }),
    ).rejects.toThrow("working-tree bytes changed");
    expect(mocks.githubApi.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
});

describe("shared checkout mechanics", () => {
  const branch = ownedBranchName("eve/fix", "root");
  it.each([
    [1, LOCAL_SHA],
    [0, "not a sha"],
  ])("restores deny-all after invalid rev-parse (%s, %s)", async (exitCode, stdout) => {
    const vm = {
      setNetworkPolicy: vi.fn(async () => {}),
      run: vi.fn(async ({ command }: { command: string }) => ({
        exitCode: command.includes("rev-parse") ? exitCode : 0,
        stdout,
        stderr: "",
      })),
    };
    await expect(checkoutOwnedBranch(vm, branch, "root")).rejects.toThrow(
      "resolve the fetched branch head",
    );
    expect(vm.setNetworkPolicy).toHaveBeenLastCalledWith("deny-all");
  });

  it("rejects another session before granting network access", async () => {
    const vm = { setNetworkPolicy: vi.fn(async () => {}), run: vi.fn() };
    await expect(checkoutOwnedBranch(vm, branch, "other")).rejects.toThrow("not owned");
    expect(vm.setNetworkPolicy).not.toHaveBeenCalled();
    expect(vm.run).not.toHaveBeenCalled();
  });
});

describe("durable publication, verification, and draft authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
  });

  it("opens the draft gate only after durable checks and matching remote attestation", async () => {
    const local = sandbox();
    mockGitDataApi();
    mocks.getGitHubRef
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ object: { sha: BASE_SHA } });
    const publication = await publishSandboxCommit({
      requestedBranch: "eve/fix",
      rootSessionId: "root",
      sandbox: local.value,
    });
    const branch = publication.branch;
    mocks.getGitHubRef.mockResolvedValue({ object: { sha: publication.sha } });
    const auth = {
      principalId: AUTONOMOUS_PRINCIPAL,
      principalType: "service",
      authenticator: "test",
      attributes: {},
    };
    const ctx = {
      session: { id: "root", auth: { current: auth, initiator: auth } },
      toolInput: { draft: true, head: branch, base: "main" },
    };
    await expect(createPullRequestPolicy(ctx)).resolves.toMatchObject({ type: "denied" });
    let current: ReviewChecks | null = null;
    const vm = {
      readTextFile: vi.fn(async () => JSON.stringify({ sha: BASE_SHA })),
      run: vi.fn(async ({ command }: { command: string }) => ({
        exitCode: 0,
        stderr: "",
        stdout: command.includes("branch --show-current")
          ? `${branch}\n${publication.sha}`
          : command.includes("diff --name-only")
            ? "README.md"
            : "",
      })),
    };
    await expect(
      attestReviewedCommit({ branch, rootSessionId: "root", sandbox: vm, current }),
    ).rejects.toThrow("incomplete");
    expect(writeDocument).not.toHaveBeenCalled();
    const plan = await reviewCheckPlan(vm);
    for (let i = 0; i < plan.checks.length; i++)
      current = await runNextReviewCheck(vm, branch, current);
    await attestReviewedCommit({ branch, rootSessionId: "root", sandbox: vm, current });
    expect(writeDocument).toHaveBeenCalledWith(
      expect.stringMatching(/review-attestations\/.*\.json/),
      JSON.stringify({ branch, sha: publication.sha }),
      { allowOverwrite: true, contentType: "application/json" },
    );
    await expect(createPullRequestPolicy(ctx)).resolves.toBe("not-applicable");
    mocks.getGitHubRef.mockResolvedValue({ object: { sha: LOCAL_SHA } });
    await expect(createPullRequestPolicy(ctx)).resolves.toMatchObject({ type: "denied" });
    await expect(
      attestReviewedCommit({ branch, rootSessionId: "root", sandbox: vm, current }),
    ).rejects.toThrow("remote branch moved");
    expect(writeDocument).toHaveBeenCalledTimes(1);
    await expect(
      createPullRequestPolicy({ ...ctx, toolInput: { ...ctx.toolInput, draft: false } }),
    ).resolves.toMatchObject({ type: "denied" });
  });
});

describe("artifact storage outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
  });

  it("distinguishes unavailable storage from nondisclosing missing IDs", async () => {
    const saved = await saveArtifact(
      { kind: "analysis", title: "Review", markdown: "Required fixes" },
      "root",
    );
    if (!saved.saved) throw new Error(saved.error);
    await expect(readArtifact(saved.id, "root")).resolves.toMatchObject({
      found: true,
      status: "found",
      markdown: "Required fixes",
    });
    await expect(readArtifact(saved.id, "other-root")).resolves.toEqual({
      found: false,
      status: "missing",
    });
    const reads = vi.mocked(readDocument).mock.calls.length;
    await expect(readArtifact("../private", "root")).resolves.toEqual({
      found: false,
      status: "missing",
    });
    expect(readDocument).toHaveBeenCalledTimes(reads);
    vi.mocked(readDocument).mockRejectedValueOnce(new Error("credentials expired"));
    await expect(readArtifact(saved.id, "root")).resolves.toEqual({
      found: false,
      status: "unavailable",
      error: expect.stringContaining("Retry"),
    });
  });
});
