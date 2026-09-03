import { FACTORY_REPO } from "../constants.js";
import { githubCredentials } from "./credentials.js";
import { mintInstallationToken } from "./git-remote.js";

const API_ROOT = `https://api.github.com/repos/${FACTORY_REPO}`;

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`GitHub API ${status}: ${message}`);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

/**
 * Call the target repository through GitHub's REST API from trusted app code.
 * Installation credentials never enter a model-controlled sandbox.
 */
export async function githubApi<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { body?: unknown; signal?: AbortSignal; token?: string } = {},
): Promise<T> {
  const token = options.token ?? (await mintInstallationToken(githubCredentials));
  const response = await fetch(`${API_ROOT}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "diff0-eve-agent",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    method,
    signal: options.signal,
  });

  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : response.statusText;
    throw new GitHubApiError(response.status, message);
  }
  return body as T;
}

/** Return `null` for an absent ref while preserving every other API failure. */
export async function getGitHubRef(
  ref: string,
  options: { signal?: AbortSignal; token?: string } = {},
): Promise<{ object: { sha: string } } | null> {
  try {
    return await githubApi<{ object: { sha: string } }>(
      "GET",
      `/git/ref/${ref.split("/").map(encodeURIComponent).join("/")}`,
      options,
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
