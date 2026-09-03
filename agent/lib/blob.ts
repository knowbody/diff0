import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

/** Managed documents must never be exposed through unauthenticated Blob URLs. */
export const DOCUMENT_ACCESS = "private" as const;

/** Blob path prefix holding the shared factory brain. */
export const FACTORY_BRAIN_PREFIX = "factory-brain/";

/** Blob path prefix holding handoff artifacts passed between stations. */
export const ARTIFACTS_PREFIX = "artifacts/";

/**
 * Read a Markdown document from the store by its exact key.
 *
 * @remarks
 * Reads through the authenticated `get` path rather than listing and fetching a public URL, so
 * one call resolves both existence and content. A missing document is a normal state
 * (`found: false`), not an error; API failures propagate for the caller to map onto its own
 * output shape.
 *
 * @param key - The exact Blob pathname, derived by the owning feature module.
 * @returns The document `content` and `uploadedAt` (ISO string) when found.
 */
export const readDocument = async (
  key: string,
): Promise<{ found: false } | { content: string; found: true; uploadedAt: string }> => {
  const result = await get(key, { access: DOCUMENT_ACCESS });
  if (!result?.stream) {
    return { found: false };
  }
  return {
    content: await new Response(result.stream).text(),
    found: true,
    uploadedAt: result.blob.uploadedAt.toISOString(),
  };
};

/**
 * Write a Markdown document to the store at its exact key.
 *
 * @remarks
 * Carries the store's shared write posture: private access, no random suffix (the key is the
 * identity), and Markdown content type. Overwrite is the caller's decision:
 * singleton documents replace themselves, while artifacts are write-once.
 *
 * @param key - The exact Blob pathname, derived by the owning feature module.
 * @param contents - The full Markdown document.
 * @param options - Whether an existing document at the key may be replaced.
 * @returns The stored blob's metadata (callers report `pathname`).
 */
export const writeDocument = (
  key: string,
  contents: string,
  options: { allowOverwrite: boolean },
) =>
  put(key, contents, {
    access: DOCUMENT_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: options.allowOverwrite,
    contentType: "text/markdown",
  });

/**
 * Delete a document from the store by its exact key.
 *
 * @remarks
 * Checks existence first so callers can tell "deleted" from "nothing to delete": `del` itself
 * is silent about missing objects.
 *
 * @param key - The exact Blob pathname, derived by the owning feature module.
 * @returns Whether a document existed at the key (and was deleted).
 */
export const deleteDocument = async (key: string): Promise<{ existed: boolean }> => {
  try {
    await head(key);
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return { existed: false };
    }
    throw error;
  }
  await del(key);
  return { existed: true };
};
