import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGitHubRef: vi.fn(),
  githubApi: vi.fn(),
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
}));

import {
  gitBlobSha,
  matchesExistingPublication,
  publishSandboxCommit,
} from "../agent/lib/github/runtime-push.js";

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
    else if (command.includes("ls-tree")) stdout = `100644 blob ${FILE_SHA}\tfile.txt\0`;
    else if (command.includes("log -1")) stdout = "Fix the thing\n";
    return { exitCode: 0, stderr: "", stdout };
  });
  return {
    run,
    value: {
      readBinaryFile: vi.fn(async () => FILE_BYTES),
      readTextFile: vi.fn(async () => JSON.stringify({ branch: "main", sha: BASE_SHA })),
      run,
    } as never,
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
    expect(commands.some((command) => command.includes(`diff --name-only -z ${BASE_SHA} ${LOCAL_SHA}`)))
      .toBe(true);
    expect(commands.some((command) => command.includes(`ls-tree -z ${LOCAL_SHA}`))).toBe(true);
    expect(commands.some((command) => command.includes(`log -1 --pretty=%B ${LOCAL_SHA}`))).toBe(true);
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
    ["merge", { message: "Fix the thing", parents: [{ sha: BASE_SHA }, { sha: LOCAL_SHA }], tree: { sha: "tree" } }],
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
