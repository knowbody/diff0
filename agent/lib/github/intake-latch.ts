import { createHash } from "node:crypto";
import { deleteDocument, readDocument, writeDocument } from "../blob.js";
import { FACTORY_REPO } from "../constants.js";

const INTAKE_LATCH_PREFIX = "intake-latches/";

export interface IntakeLatchStorage {
  delete(key: string): Promise<unknown>;
  read(key: string): Promise<{ found: boolean }>;
  write(key: string, contents: string, options: { allowOverwrite: boolean }): Promise<unknown>;
}

const documentStorage: IntakeLatchStorage = {
  delete: deleteDocument,
  read: readDocument,
  write: writeDocument,
};

/** One stable private latch per repository issue. */
export function intakeLatchKey(issueNumber: number): string {
  const id = createHash("sha256").update(`${FACTORY_REPO}\0${issueNumber}`).digest("hex");
  return `${INTAKE_LATCH_PREFIX}${id}.json`;
}

/**
 * Claim an issue-label intake at most once while its label remains present.
 * Blob's no-overwrite write is the atomic boundary for concurrent deliveries.
 */
export async function claimIntakeLatch(
  issueNumber: number,
  deliveryId: string,
  storage: IntakeLatchStorage = documentStorage,
): Promise<boolean> {
  const key = intakeLatchKey(issueNumber);
  if ((await storage.read(key)).found) return false;

  try {
    await storage.write(
      key,
      JSON.stringify({ claimedAt: new Date().toISOString(), deliveryId, issueNumber }),
      { allowOverwrite: false },
    );
    return true;
  } catch (error) {
    // Another concurrent webhook may have won between our read and create.
    // A storage failure with no resulting latch is operational and must remain
    // visible to Eve's delivery logs rather than being treated as a rejection.
    if ((await storage.read(key)).found) return false;
    throw error;
  }
}

/** Removing the intake label deliberately rearms the issue. */
export async function clearIntakeLatch(
  issueNumber: number,
  storage: IntakeLatchStorage = documentStorage,
): Promise<void> {
  await storage.delete(intakeLatchKey(issueNumber));
}
