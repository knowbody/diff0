import { createHash } from "node:crypto";
import { readDocument, writeDocument } from "../blob.js";
import { FACTORY_REPO } from "../constants.js";

const REVIEW_ATTESTATION_PREFIX = "review-attestations/";
const SHA_PATTERN = /^[a-f0-9]{40}$/;

export interface ReviewAttestation {
  branch: string;
  sha: string;
}

/** Private key for one root session and branch, derived without model-controlled path segments. */
export function reviewAttestationKey(rootSessionId: string, branch: string): string {
  const id = createHash("sha256")
    .update(`${FACTORY_REPO}\0${rootSessionId}\0${branch}`)
    .digest("hex");
  return `${REVIEW_ATTESTATION_PREFIX}${id}.json`;
}

export async function saveReviewAttestation(
  rootSessionId: string,
  attestation: ReviewAttestation,
): Promise<void> {
  await writeDocument(
    reviewAttestationKey(rootSessionId, attestation.branch),
    JSON.stringify(attestation),
    { allowOverwrite: true },
  );
}

export async function readReviewAttestation(
  rootSessionId: string,
  branch: string,
): Promise<ReviewAttestation | null> {
  const document = await readDocument(reviewAttestationKey(rootSessionId, branch));
  if (!document.found) return null;
  try {
    const value = JSON.parse(document.content) as Partial<ReviewAttestation>;
    return value.branch === branch && typeof value.sha === "string" && SHA_PATTERN.test(value.sha)
      ? { branch, sha: value.sha }
      : null;
  } catch {
    return null;
  }
}
