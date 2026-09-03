import { createHash } from "node:crypto";
import type { SandboxSession } from "eve/sandbox";
import { FACTORY_BRANCH_PREFIX } from "../constants.js";
import { getGitHubRef, githubApi } from "./api.js";
import { githubCredentials } from "./credentials.js";
import {
  mintInstallationToken,
  REPO_DIR,
  validateBranch,
  validateBranchName,
} from "./git-remote.js";

export const BASE_MARKER_PATH = "/workspace/.eve-factory-base.json";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_CHANGED_FILES = 500;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

interface BaseMarker {
  branch: string;
  sha: string;
}

interface TreeEntry {
  mode?: "100644" | "100755";
  path: string;
  sha: string | null;
  type?: "blob";
}

export interface ExistingPublication {
  message: string;
  parents: Array<{ sha: string }>;
  tree: { sha: string };
}

/** Exact identity required before treating an existing remote commit as a retry. */
export function matchesExistingPublication(
  existing: ExistingPublication,
  intended: { message: string; parentSha: string; treeSha: string },
): boolean {
  return (
    existing.tree.sha === intended.treeSha &&
    existing.parents.length === 1 &&
    existing.parents[0]?.sha === intended.parentSha &&
    existing.message === intended.message
  );
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const runGit = async (sandbox: SandboxSession, args: string): Promise<string> => {
  const result = await sandbox.run({
    command: `/usr/bin/git -c core.hooksPath=/dev/null -C ${REPO_DIR} ${args}`,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Local git inspection failed (exit ${result.exitCode}): ${String(
        result.stderr || result.stdout,
      ).trim()}`,
    );
  }
  return String(result.stdout);
};

export const branchOwnerToken = (rootSessionId: string): string =>
  createHash("sha256").update(rootSessionId).digest("hex").slice(0, 12);

/** Git object id for file bytes, used to bind mutable filesystem reads to HEAD. */
export function gitBlobSha(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

/**
 * Convert the human-readable local branch into a branch owned by this root
 * session. A branch already owned by another session is rejected rather than
 * silently retargeted.
 */
export function ownedBranchName(requested: string, rootSessionId: string): string {
  const refusal = validateBranch(requested);
  if (refusal) {
    throw new Error(refusal);
  }
  const suffix = requested.slice(FACTORY_BRANCH_PREFIX.length);
  const token = branchOwnerToken(rootSessionId);
  if (suffix.startsWith(`${token}-`)) {
    return requested;
  }
  if (/^[a-f0-9]{12}-/.test(suffix)) {
    throw new Error("That branch belongs to a different agent session.");
  }
  return `${FACTORY_BRANCH_PREFIX}${token}-${suffix}`;
}

export function isOwnedBranch(branch: string, rootSessionId: string): boolean {
  return branch.startsWith(`${FACTORY_BRANCH_PREFIX}${branchOwnerToken(rootSessionId)}-`);
}

export function validateChangedPath(path: string): string | null {
  const hasControlCharacter = Array.from(path).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (path.length === 0 || path.length > 1024 || path.startsWith("/") || hasControlCharacter) {
    return "Changed paths must be relative, printable repository paths.";
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "Changed paths may not traverse or contain empty segments.";
  }
  if (segments[0] === ".git") {
    return "The .git directory is never publishable.";
  }
  return null;
}

async function readBaseMarker(sandbox: SandboxSession): Promise<BaseMarker> {
  const raw = await sandbox.readTextFile({ path: BASE_MARKER_PATH });
  if (raw === null) {
    throw new Error("The sandbox checkout has no trusted base marker; start a fresh session.");
  }
  const marker = JSON.parse(raw) as Partial<BaseMarker>;
  if (
    typeof marker.branch !== "string" ||
    validateBranchName(marker.branch) !== null ||
    typeof marker.sha !== "string" ||
    !SHA_PATTERN.test(marker.sha)
  ) {
    throw new Error(
      "The sandbox checkout has no valid trusted base marker; start a fresh session.",
    );
  }
  return { branch: marker.branch, sha: marker.sha };
}

async function changedPaths(
  sandbox: SandboxSession,
  baseSha: string,
  localSha: string,
): Promise<string[]> {
  const status = await runGit(sandbox, "status --porcelain=v1 --untracked-files=all");
  if (status.trim() !== "") {
    throw new Error("Commit every intended change before publishing the branch.");
  }
  await runGit(sandbox, `merge-base --is-ancestor ${baseSha} ${localSha}`);
  const output = await runGit(sandbox, `diff --name-only -z ${baseSha} ${localSha}`);
  const paths = output.split("\0").filter(Boolean);
  if (paths.length === 0) {
    throw new Error("The branch contains no committed changes.");
  }
  if (paths.length > MAX_CHANGED_FILES) {
    throw new Error(`The branch changes ${paths.length} files; the limit is ${MAX_CHANGED_FILES}.`);
  }
  for (const path of paths) {
    const refusal = validateChangedPath(path);
    if (refusal) {
      throw new Error(`${refusal} Received: ${JSON.stringify(path)}`);
    }
  }
  return paths;
}

async function treeEntryForPath(
  sandbox: SandboxSession,
  localSha: string,
  path: string,
): Promise<{ bytes?: Uint8Array; entry: TreeEntry }> {
  const line = await runGit(sandbox, `ls-tree -z ${localSha} -- ${shellQuote(path)}`);
  if (line === "") {
    return { entry: { path, sha: null } };
  }
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(line);
  if (!match || match[3] !== path) {
    throw new Error(`Only regular files may be published; unsupported entry: ${path}`);
  }
  const bytes = await sandbox.readBinaryFile({ path: `${REPO_DIR}/${path}` });
  if (bytes === null) {
    throw new Error(`The committed file is missing from the sandbox: ${path}`);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `${path} is ${bytes.byteLength} bytes; the per-file limit is ${MAX_FILE_BYTES}.`,
    );
  }
  if (gitBlobSha(bytes) !== match[2]) {
    throw new Error(`The working-tree bytes changed after commit inspection: ${path}`);
  }
  return {
    bytes,
    entry: { mode: match[1] as "100644" | "100755", path, sha: "", type: "blob" },
  };
}

/**
 * Publish one squashed commit through GitHub's Git Data API. The sandbox is
 * used only as an untrusted source of validated file bytes; its processes and
 * Git configuration never receive a write-capable credential.
 */
export async function publishSandboxCommit(input: {
  requestedBranch: string;
  rootSessionId: string;
  sandbox: SandboxSession;
  signal?: AbortSignal;
}): Promise<{ branch: string; changedFiles: number; sha: string }> {
  const branch = ownedBranchName(input.requestedBranch, input.rootSessionId);
  const marker = await readBaseMarker(input.sandbox);
  // One installation token is enough for the complete publication. Minting
  // once avoids one connector round trip for every changed file.
  const token = await mintInstallationToken(githubCredentials);
  const repository = await githubApi<{ default_branch: string }>("GET", "", {
    signal: input.signal,
    token,
  });
  const remoteBranch = await getGitHubRef(`heads/${branch}`, { signal: input.signal, token });
  const localSha = (await runGit(input.sandbox, "rev-parse --verify HEAD^{commit}"))
    .trim()
    .toLowerCase();
  if (!SHA_PATTERN.test(localSha)) {
    throw new Error("The sandbox checkout does not have a valid committed HEAD.");
  }

  const startsFromDefault = marker.branch === repository.default_branch;
  if (!startsFromDefault) {
    if (marker.branch !== branch || remoteBranch === null) {
      throw new Error("The remote branch moved or is not owned by this session; fetch it again.");
    }
  }

  const paths = await changedPaths(input.sandbox, marker.sha, localSha);
  const localEntries = await Promise.all(
    paths.map((path) => treeEntryForPath(input.sandbox, localSha, path)),
  );
  const totalBytes = localEntries.reduce((sum, item) => sum + (item.bytes?.byteLength ?? 0), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `The branch changes ${totalBytes} bytes; the total limit is ${MAX_TOTAL_BYTES}.`,
    );
  }

  const entries: TreeEntry[] = [];
  for (const item of localEntries) {
    if (item.bytes === undefined) {
      entries.push(item.entry);
      continue;
    }
    const blob = await githubApi<{ sha: string }>("POST", "/git/blobs", {
      body: { content: Buffer.from(item.bytes).toString("base64"), encoding: "base64" },
      signal: input.signal,
      token,
    });
    entries.push({ ...item.entry, sha: blob.sha });
  }

  const parent = await githubApi<{ tree: { sha: string } }>("GET", `/git/commits/${marker.sha}`, {
    signal: input.signal,
    token,
  });
  const tree = await githubApi<{ sha: string }>("POST", "/git/trees", {
    body: { base_tree: parent.tree.sha, tree: entries },
    signal: input.signal,
    token,
  });
  const localMessage = (await runGit(input.sandbox, `log -1 --pretty=%B ${localSha}`)).trim();
  const intendedMessage = localMessage.slice(0, 5000) || "Agent-authored change";

  // A lost successful ref-update response can cause the tool call to be
  // retried. Accept the already-published result only when both its parent
  // and complete tree match the intended publication exactly.
  if (remoteBranch !== null && (startsFromDefault || remoteBranch.object.sha !== marker.sha)) {
    const existing = await githubApi<ExistingPublication>(
      "GET",
      `/git/commits/${remoteBranch.object.sha}`,
      {
        signal: input.signal,
        token,
      },
    );
    if (
      matchesExistingPublication(existing, {
        message: intendedMessage,
        parentSha: marker.sha,
        treeSha: tree.sha,
      })
    ) {
      return { branch, changedFiles: paths.length, sha: remoteBranch.object.sha };
    }
    throw new Error("The remote branch moved or contains a different publication; fetch it again.");
  }

  // Only a genuinely new publication requires the base ref to remain live.
  // Exact retries above remain valid even if an unrelated default-branch
  // commit landed after GitHub accepted our original ref update.
  if (startsFromDefault) {
    const defaultRef = await getGitHubRef(`heads/${repository.default_branch}`, {
      signal: input.signal,
      token,
    });
    if (defaultRef?.object.sha !== marker.sha) {
      throw new Error(
        "The default branch moved after this sandbox started; restart from its new head.",
      );
    }
  }

  const commit = await githubApi<{ sha: string }>("POST", "/git/commits", {
    body: {
      message: intendedMessage,
      parents: [marker.sha],
      tree: tree.sha,
    },
    signal: input.signal,
    token,
  });

  try {
    if (remoteBranch === null) {
      await githubApi("POST", "/git/refs", {
        body: { ref: `refs/heads/${branch}`, sha: commit.sha },
        signal: input.signal,
        token,
      });
    } else {
      await githubApi(
        "PATCH",
        `/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
        {
          body: { force: false, sha: commit.sha },
          signal: input.signal,
          token,
        },
      );
    }
  } catch (error) {
    const observed = await getGitHubRef(`heads/${branch}`, {
      signal: input.signal,
      token,
    }).catch(() => null);
    if (observed?.object.sha !== commit.sha) throw error;
  }

  return { branch, changedFiles: paths.length, sha: commit.sha };
}
