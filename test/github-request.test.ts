import { describe, expect, it } from "vitest";
import { requestGitHub, retryDelayMs } from "../action/github-request.mjs";

describe("Action GitHub transport", () => {
  it("waits for Retry-After and releases the discarded response body", async () => {
    const waits: number[] = [];
    const signals: AbortSignal[] = [];
    const first = new Response("busy", { status: 429, headers: { "retry-after": "2" } });
    const result = await requestGitHub(
      async (_url: string, options: RequestInit) => {
        signals.push(options.signal as AbortSignal);
        return signals.length === 1 ? first : new Response("ok");
      },
      "https://api.github.com/test",
      {
        token: "test",
        sleep: async (ms: number) => {
          waits.push(ms);
        },
      },
    );
    expect(result.status).toBe(200);
    expect(waits).toEqual([2000]);
    expect(first.bodyUsed).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("does not shorten a rate-limit window beyond its retry budget", async () => {
    let calls = 0;
    const result = await requestGitHub(
      async () => {
        calls += 1;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "60" } });
      },
      "https://api.github.com/test",
      {
        token: "test",
        sleep: async () => {
          throw new Error("must not sleep");
        },
      },
    );
    expect(result.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("never retries POST after an ambiguous failure", async () => {
    let calls = 0;
    await expect(
      requestGitHub(
        async () => {
          calls += 1;
          throw new Error("connection lost");
        },
        "https://api.github.com/test",
        { token: "test", method: "POST" },
      ),
    ).rejects.toThrow("connection lost");
    expect(calls).toBe(1);
  });

  it("bounds stalled requests with a fresh deadline on each allowed attempt", async () => {
    let calls = 0;
    await expect(
      requestGitHub(
        async (_url: string, options: RequestInit) => {
          calls += 1;
          return new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
              once: true,
            });
          });
        },
        "https://api.github.com/test",
        { token: "test", timeoutMs: 10, sleep: async () => {} },
      ),
    ).rejects.toThrow("after one retry");
    expect(calls).toBe(2);
  });

  it("parses server dates and falls back for malformed retry headers", () => {
    const now = Date.parse("2026-09-07T00:00:00Z");
    expect(retryDelayMs("Mon, 07 Sep 2026 00:00:03 GMT", now)).toBe(3000);
    expect(retryDelayMs("nonsense", now)).toBe(500);
    expect(retryDelayMs("-5", now)).toBe(0);
  });
});
