import type { GitHubChannelCredentials } from "eve/channels/github";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import { FACTORY_BRANCH_PREFIX, FACTORY_REPO, factoryRepo } from "../constants.js";

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/**
 * Conservative subset of valid git branch names: alphanumeric segments
 * separated by `.`, `_`, `-` or `/`. Everything the git commands interpolate
 * has to match this, so shell metacharacters can never reach the command
 * line.
 */
const BRANCH_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/**
 * Where the station sandboxes keep the factory repository checkout.
 */
export const REPO_DIR = "/workspace/repo";

/**
 * The URL every sandbox clone and fetch targets, literally.
 *
 * @remarks
 * Git remote config inside a sandbox (`pushurl`, `pushDefault`, per-branch
 * remotes) is model-writable and must not be able to redirect the brokered
 * read credential, so the git helpers never go through `origin`.
 */
export const REMOTE_URL = `https://github.com/${FACTORY_REPO}.git`;

/**
 * Returns the refusal reason, or null when the branch name may be used in a
 * git command.
 *
 * @remarks
 * `refs/heads/main` and `HEAD` would reach a protected branch under another
 * name, so only plain branch names are accepted, and the protected branches
 * themselves are refused outright: the factory delivers pull requests, never
 * direct pushes to the default branch.
 */
export function validateBranchName(branch: string): string | null {
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.includes("//")) {
    return `"${branch}" is not a valid branch name.`;
  }
  if (branch.startsWith("refs/") || branch === "HEAD") {
    return `"${branch}" is not a plain branch name. Pass the branch name without a refs/ prefix.`;
  }
  return null;
}

/** Validate a branch the factory is allowed to fetch or push. */
export function validateBranch(branch: string, defaultBranch?: string): string | null {
  const invalid = validateBranchName(branch);
  if (invalid) {
    return invalid;
  }
  if (!branch.startsWith(FACTORY_BRANCH_PREFIX) || branch === FACTORY_BRANCH_PREFIX) {
    return `Factory branches must start with "${FACTORY_BRANCH_PREFIX}".`;
  }
  if (PROTECTED_BRANCHES.has(branch) || branch === defaultBranch) {
    return `Direct pushes to ${branch} are not allowed. Push a feature branch and open a pull request.`;
  }
  return null;
}

export interface FactoryRepositoryMetadata {
  readonly defaultBranch: string;
}

/** Read the repository's current default branch in trusted app runtime. */
export async function fetchFactoryRepositoryMetadata(
  installationToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FactoryRepositoryMetadata> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${factoryRepo.owner}/${factoryRepo.repo}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to read ${FACTORY_REPO} metadata from GitHub (${response.status}).`);
  }
  const body = (await response.json()) as { default_branch?: unknown };
  if (typeof body.default_branch !== "string" || validateBranchName(body.default_branch) !== null) {
    throw new Error(`GitHub returned no usable default branch for ${FACTORY_REPO}.`);
  }
  return { defaultBranch: body.default_branch };
}

export interface DraftPullRequestInput {
  readonly base?: unknown;
  readonly draft?: unknown;
  readonly head?: unknown;
}

/** Validate the factory provenance carried by a draft pull-request request. */
export function validateDraftPullRequest(
  input: DraftPullRequestInput | undefined,
  defaultBranch: string,
): string | null {
  if (input?.draft !== true) {
    return "The factory may open only draft pull requests without a person.";
  }
  if (typeof input.head !== "string") {
    return "The pull request head must be a factory branch.";
  }
  const invalidHead = validateBranch(input.head, defaultBranch);
  if (invalidHead) {
    return invalidHead;
  }
  if (input.base !== defaultBranch) {
    return `The pull request base must be the repository's default branch (${defaultBranch}).`;
  }
  return null;
}

/**
 * Firewall policy that brokers the installation token only onto Git's
 * read-only upload-pack protocol.
 *
 * @remarks
 * The token never enters the sandbox process. Exact method, path, and query
 * matching prevents sandbox processes from carrying it to receive-pack or a
 * general GitHub API request. No catch-all is present, so unrelated egress is
 * denied while the credential is active.
 */
export function brokerPolicy(installationToken: string): SandboxNetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString(
    "base64",
  )}`;
  return {
    allow: {
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: `/${FACTORY_REPO}.git/info/refs` },
            queryString: [{ key: { exact: "service" }, value: { exact: "git-upload-pack" } }],
          },
          transform: [{ headers: { Authorization: authorization } }],
        },
        {
          match: {
            method: ["POST"],
            path: { exact: `/${FACTORY_REPO}.git/git-upload-pack` },
          },
          transform: [{ headers: { Authorization: authorization } }],
        },
      ],
    },
  };
}

/**
 * Resolves the Connect-managed installation token, minting when it is lazy.
 */
export async function mintInstallationToken(
  credentials: GitHubChannelCredentials,
): Promise<string> {
  const token = credentials.installationToken;
  if (token === undefined) {
    throw new Error("The GitHub connector exposes no installation token.");
  }
  return typeof token === "function" ? await token() : token;
}
