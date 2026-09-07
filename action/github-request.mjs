/** Bounded GitHub requests. POST is intentionally never retried here. */
import { setTimeout as delay } from "node:timers/promises";

const TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 5_000;

export function retryDelayMs(header, now = Date.now()) {
  if (!header) return 500;
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 500;
}

/**
 * @param {(url: string, options: RequestInit) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {{ token: string, method?: string, body?: unknown, sleep?: (ms: number) => Promise<void>, timeoutMs?: number }} options
 */
export async function requestGitHub(
  fetchImpl,
  url,
  { token, method = "GET", body, sleep = delay, timeoutMs = TIMEOUT_MS },
) {
  const mayRetry = method === "GET" || method === "HEAD" || method === "PATCH";
  const options = {
    method,
    redirect: /** @type {const} */ ("error"),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "diff0-action",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  for (let attempt = 0; attempt < (mayRetry ? 2 : 1); attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (mayRetry && attempt === 0) {
        await sleep(500);
        continue;
      }
      throw new Error(
        `Network error calling ${method} ${url}${mayRetry ? " (after one retry)" : ""}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (mayRetry && attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const waitMs = retryDelayMs(response.headers.get("retry-after"));
      // Respect long server retry windows by returning the response to the caller;
      // don't shorten them and immediately hit an already rate-limited endpoint.
      if (waitMs > MAX_RETRY_WAIT_MS) return response;
      await response.body?.cancel();
      await sleep(waitMs);
      continue;
    }
    return response;
  }
  throw new Error(`Request failed unexpectedly: ${method} ${url}`);
}
