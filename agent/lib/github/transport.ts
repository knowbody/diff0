import { setTimeout as delay } from "node:timers/promises";

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`GitHub API ${status}: ${message}`);
    this.name = "GitHubApiError";
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5_000;

function retryDelay(response: Response, attempt: number): number | null {
  if (![429, 500, 502, 503, 504].includes(response.status)) return null;
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  const milliseconds =
    header === null
      ? 250 * 2 ** attempt
      : Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(header) - Date.now();
  // Do not retry sooner than GitHub requested or park a hosted tool for minutes.
  return Number.isFinite(milliseconds) && milliseconds <= MAX_RETRY_DELAY_MS
    ? Math.max(0, milliseconds)
    : null;
}

/**
 * Repository wrappers own URL scope and credentials. This transport owns the
 * deadline and GET-only retries; ambiguous writes require operation-level recovery.
 * The installed SDK factory forces a newer API version and default Octokit retry
 * hooks, so it is intentionally not used for these publication operations.
 */
export async function githubRequest<T>(
  url: string,
  method: "GET" | "POST" | "PATCH",
  token: string,
  options: { body?: unknown; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await (options.fetchImpl ?? fetch)(url, {
      method,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "diff0-eve-agent",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
      redirect: "error",
    });
    const body: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (response.ok) {
      if (body === null) throw new Error("GitHub returned an invalid JSON response.");
      return body as T;
    }
    const wait = method === "GET" && attempt < 2 ? retryDelay(response, attempt) : null;
    if (wait !== null) {
      await delay(wait, undefined, { signal });
      continue;
    }
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : response.statusText;
    throw new GitHubApiError(response.status, message);
  }
}
