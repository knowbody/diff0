import * as blob from "@vercel/blob";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFactoryBrain, updateFactoryBrain } from "../agent/lib/factory-brain.js";

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  get: vi.fn(),
  put: vi.fn(),
}));

// Exercise the real document adapter against storage with atomic ETag semantics.
function store(initial?: string) {
  let content = initial;
  let revision = initial === undefined ? 0 : 1;
  const get = vi.mocked(blob.get).mockImplementation(async () => {
    if (content === undefined) return null;
    return {
      statusCode: 200,
      stream: new Response(content).body,
      blob: { etag: `v${revision}`, uploadedAt: new Date("2026-09-07T00:00:00Z") },
    } as Awaited<ReturnType<typeof blob.get>>;
  });
  const put = vi.mocked(blob.put).mockImplementation(async (key, body, options) => {
    if (
      (options?.ifMatch !== undefined && options.ifMatch !== `v${revision}`) ||
      (options?.allowOverwrite === false && content !== undefined)
    ) {
      throw new blob.BlobPreconditionFailedError();
    }
    content = String(body);
    revision++;
    return { pathname: key, etag: `v${revision}` } as Awaited<ReturnType<typeof blob.put>>;
  });
  return { get, put, content: () => content };
}

afterEach(() => vi.resetAllMocks());

describe("factory brain concurrency", () => {
  it("does not overwrite a concurrent update made after the caller read", async () => {
    const storage = store("Original note");
    const [first, second] = await Promise.all([readFactoryBrain(), readFactoryBrain()]);
    const results = await Promise.allSettled([
      updateFactoryBrain(`${first.brain}\nNote A`, first.version),
      updateFactoryBrain(`${second.brain}\nNote B`, second.version),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const latest = await readFactoryBrain();
    await updateFactoryBrain(`${latest.brain}\nNote B`, latest.version);
    expect(storage.content()).toBe("Original note\nNote A\nNote B");
    expect(storage.get).toHaveBeenCalledWith(expect.any(String), {
      access: "private",
      useCache: false,
    });
    expect(storage.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ ifMatch: "v2", access: "private" }),
    );
  });

  it("allows only one concurrent creator when both readers saw a missing brain", async () => {
    const storage = store();
    const [first, second] = await Promise.all([readFactoryBrain(), readFactoryBrain()]);
    expect(first.version).toBeNull();
    const results = await Promise.allSettled([
      updateFactoryBrain("Note A", first.version),
      updateFactoryBrain("Note B", second.version),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(storage.content()).toBe("Note A");
  });

  it("does not turn a failed read into permission to create a replacement", async () => {
    store("Keep me").get.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(readFactoryBrain()).rejects.toThrow("storage unavailable");
    expect(blob.put).not.toHaveBeenCalled();
  });
});
