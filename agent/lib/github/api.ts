import { FACTORY_REPO } from "../constants.js";
import { githubCredentials } from "./credentials.js";
import { GitHubApiError, githubRequest } from "./transport.js";

export { GitHubApiError } from "./transport.js";

import { mintInstallationToken } from "./git-remote.js";

const API_ROOT = `https://api.github.com/repos/${FACTORY_REPO}`;

/**
 * Call the target repository through GitHub's REST API from trusted app code.
 * Installation credentials never enter a model-controlled sandbox.
 */
export async function githubApi<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { body?: unknown; signal?: AbortSignal; token?: string } = {},
): Promise<T> {
  const url = new URL(`${API_ROOT}${path}`);
  if (
    url.origin !== "https://api.github.com" ||
    !url.pathname.startsWith(new URL(API_ROOT).pathname + (path ? "/" : ""))
  ) {
    throw new Error("GitHub requests must remain within the factory repository.");
  }
  const token = options.token ?? (await mintInstallationToken(githubCredentials));
  return githubRequest<T>(url.href, method, token, options);
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
