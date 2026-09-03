import type { SessionAuthContext } from "eve/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedCommenter } from "../agent/channels/github.js";
import { artifactId, artifactKey, artifactScope } from "../agent/lib/artifacts/config.js";
import { DOCUMENT_ACCESS } from "../agent/lib/blob.js";
import { FACTORY_BRANCH_PREFIX, FACTORY_REPO, factoryRepo } from "../agent/lib/constants.js";
import {
  closeIssuePolicy,
  commentPolicy,
  isReviewedRemoteCommit,
  labelPolicy,
  updateIssuePolicy,
  writePolicy,
} from "../agent/lib/github/approval.js";
import {
  brokerPolicy,
  fetchFactoryRepositoryMetadata,
  validateBranch,
  validateBranchName,
  validateDraftPullRequest,
} from "../agent/lib/github/git-remote.js";
import {
  claimIntakeLatch,
  clearIntakeLatch,
  type IntakeLatchStorage,
  intakeLatchKey,
} from "../agent/lib/github/intake-latch.js";
import { isFactoryRepository } from "../agent/lib/github/provenance.js";
import { reviewAttestationKey } from "../agent/lib/github/review-attestation.js";
import {
  branchOwnerToken,
  gitBlobSha,
  isOwnedBranch,
  ownedBranchName,
  validateChangedPath,
} from "../agent/lib/github/runtime-push.js";
import {
  AUTONOMOUS_PRINCIPAL,
  INTAKE_ISSUE_ATTRIBUTE,
  isAutonomousSession,
  isTrustedSession,
  TRUSTED_ATTRIBUTE,
} from "../agent/lib/trust.js";
import { requireMutatingEvalRepository } from "../evals/helpers.js";

const principal = (
  principalId: string,
  attributes: Readonly<Record<string, string>> = {},
  principalType = "user",
): SessionAuthContext => ({
  attributes,
  authenticator: "test",
  principalId,
  principalType,
});

const trusted = principal("github:1", { [TRUSTED_ATTRIBUTE]: "true" });
const otherTrusted = principal("github:2", { [TRUSTED_ATTRIBUTE]: "true" });
const untrusted = principal("github:3");
const autonomous = principal(AUTONOMOUS_PRINCIPAL, { [INTAKE_ISSUE_ATTRIBUTE]: "17" }, "service");
const nonFactoryBranch =
  FACTORY_BRANCH_PREFIX === "outside/" ? "different/bug-fix" : "outside/bug-fix";

const approvalContext = (
  current: SessionAuthContext | null,
  initiator: SessionAuthContext | null,
  toolInput?: Record<string, unknown>,
) =>
  ({
    approvedTools: new Set<string>(),
    callId: "call-1",
    session: {
      auth: { current, initiator },
      id: "session-1",
      turn: { id: "turn-1", sequence: 1 },
    },
    toolInput,
    toolName: "test",
  }) as never;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mutating eval guard", () => {
  it("requires a deliberate disposable repository target", () => {
    vi.stubEnv("ALLOW_MUTATING_EVALS", "1");
    vi.stubEnv("FACTORY_REPO", "example/scratch-agent");
    vi.stubEnv("MUTATING_EVAL_REPO", "example/scratch-agent");
    expect(() => requireMutatingEvalRepository()).not.toThrow();
  });

  it.each([
    ["missing opt-in", undefined, "example/scratch-agent", "example/scratch-agent"],
    ["production repository", "1", "knowbody/diff0", "knowbody/diff0"],
    ["mismatched target", "1", "example/other", "example/scratch-agent"],
  ])("refuses %s", (_name, allow, target, scratchRepo) => {
    vi.stubEnv("ALLOW_MUTATING_EVALS", allow);
    vi.stubEnv("FACTORY_REPO", target);
    vi.stubEnv("MUTATING_EVAL_REPO", scratchRepo);
    expect(() => requireMutatingEvalRepository()).toThrow(/Mutating eval/);
  });
});

describe("GitHub repository provenance", () => {
  it.each([
    ["exact repository", factoryRepo.owner, factoryRepo.repo, FACTORY_REPO, true],
    [
      "canonical casing",
      factoryRepo.owner.toUpperCase(),
      factoryRepo.repo.toUpperCase(),
      FACTORY_REPO.toUpperCase(),
      true,
    ],
    ["different owner", "attacker", factoryRepo.repo, `attacker/${factoryRepo.repo}`, false],
    ["different repo", factoryRepo.owner, "other", `${factoryRepo.owner}/other`, false],
    [
      "inconsistent full name",
      factoryRepo.owner,
      factoryRepo.repo,
      `attacker/${factoryRepo.repo}`,
      false,
    ],
  ])("checks %s", (_name, owner, name, fullName, expected) => {
    expect(isFactoryRepository({ fullName, id: 1, name, owner, private: false })).toBe(expected);
  });
});

describe("session trust", () => {
  it.each([
    ["trusted lineage", trusted, otherTrusted, true],
    ["untrusted initiator", trusted, untrusted, false],
    ["untrusted current caller", untrusted, trusted, false],
    ["missing initiator", trusted, null, true],
  ])("checks %s", (_name, current, initiator, expected) => {
    expect(isTrustedSession({ current, initiator })).toBe(expected);
  });

  it("keeps an autonomously initiated session restricted after a human follow-up", () => {
    expect(isAutonomousSession({ current: trusted, initiator: autonomous })).toBe(true);
    expect(writePolicy(approvalContext(trusted, autonomous))).toMatchObject({ type: "denied" });
  });
});

describe("GitHub comment dispatch trust", () => {
  const contextWithRole = (role: string | null) =>
    ({
      github: {
        request: vi.fn(async () => ({ body: role === null ? {} : { role_name: role } })),
      },
      repository: { name: "diff0", owner: "knowbody" },
      sender: { login: "maintainer" },
    }) as never;

  it.each([
    ["admin", true],
    ["maintain", true],
    ["write", true],
    ["triage", false],
    ["read", false],
    [null, false],
  ])("treats repository role %s as trusted=%s", async (role, expected) => {
    await expect(isTrustedCommenter(contextWithRole(role))).resolves.toBe(expected);
  });

  it("propagates permission API failures instead of granting trust", async () => {
    const ctx = contextWithRole("write") as {
      github: { request: ReturnType<typeof vi.fn> };
    };
    ctx.github.request.mockRejectedValueOnce(new Error("permission lookup failed"));
    await expect(isTrustedCommenter(ctx as never)).rejects.toThrow("permission lookup failed");
  });
});

describe("autonomous issue write scope", () => {
  const policies = [commentPolicy, labelPolicy, closeIssuePolicy, updateIssuePolicy] as const;

  it.each(policies)("allows %s on the stamped intake issue", (policy) => {
    expect(policy(approvalContext(autonomous, autonomous, { issueNumber: 17 }))).toBe(
      "not-applicable",
    );
  });

  it.each(policies)("denies %s on another issue", (policy) => {
    expect(policy(approvalContext(autonomous, autonomous, { issueNumber: 18 }))).toMatchObject({
      type: "denied",
    });
  });

  it("does not let a trusted follow-up escape the autonomous intake scope", () => {
    expect(labelPolicy(approvalContext(trusted, autonomous, { issueNumber: 18 }))).toMatchObject({
      type: "denied",
    });
  });

  it.each(["title", "body", "milestone", "assignees"])(
    "denies autonomous changes to %s",
    (field) => {
      expect(
        updateIssuePolicy(
          approvalContext(autonomous, autonomous, { issueNumber: 17, [field]: "changed" }),
        ),
      ).toMatchObject({ type: "denied" });
    },
  );
});

describe("branch and pull-request validation", () => {
  it.each([
    [`${FACTORY_BRANCH_PREFIX}bug-fix`, "main", null],
    [nonFactoryBranch, "main", "must start"],
    [`${FACTORY_BRANCH_PREFIX}bug-fix`, `${FACTORY_BRANCH_PREFIX}bug-fix`, "Direct pushes"],
    ["main", "main", "must start"],
    [`${FACTORY_BRANCH_PREFIX}../main`, "main", "not a valid branch"],
  ])("validates %s", (branch, defaultBranch, errorFragment) => {
    const result = validateBranch(branch, defaultBranch);
    if (errorFragment === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toContain(errorFragment);
    }
  });

  it.each(["main", "develop", "trunk", "release/2026-09"])(
    "accepts a plain remote branch name: %s",
    (branch) => expect(validateBranchName(branch)).toBeNull(),
  );

  it.each([
    ["valid", { base: "main", draft: true, head: `${FACTORY_BRANCH_PREFIX}bug-fix` }, null],
    [
      "not draft",
      { base: "main", draft: false, head: `${FACTORY_BRANCH_PREFIX}bug-fix` },
      "only draft",
    ],
    [
      "wrong base",
      { base: "release", draft: true, head: `${FACTORY_BRANCH_PREFIX}bug-fix` },
      "default branch",
    ],
    ["wrong head", { base: "main", draft: true, head: nonFactoryBranch }, "must start"],
  ])("checks %s pull request input", (_name, input, errorFragment) => {
    const result = validateDraftPullRequest(input, "main");
    if (errorFragment === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toContain(errorFragment);
    }
  });

  it("loads the current default branch from GitHub without exposing the token", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ default_branch: "trunk" }, { status: 200 }),
    );
    await expect(fetchFactoryRepositoryMetadata("secret-token", fetchImpl)).resolves.toEqual({
      defaultBranch: "trunk",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/${FACTORY_REPO}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
  });
});

describe("credential and branch capability boundaries", () => {
  it("brokers GitHub auth only onto read-only upload-pack requests", () => {
    const policy = brokerPolicy("secret-token");
    expect(policy).toMatchObject({
      allow: {
        "github.com": [
          { match: { method: ["GET"], path: { exact: `/${FACTORY_REPO}.git/info/refs` } } },
          {
            match: {
              method: ["POST"],
              path: { exact: `/${FACTORY_REPO}.git/git-upload-pack` },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(policy)).not.toContain("git-receive-pack");
    expect(policy).not.toMatchObject({ allow: { "*": [] } });
  });

  it("derives a branch namespace bound to one root session", () => {
    const requested = `${FACTORY_BRANCH_PREFIX}bug-fix`;
    const owned = ownedBranchName(requested, "root-session-1");
    expect(owned).toBe(`${FACTORY_BRANCH_PREFIX}${branchOwnerToken("root-session-1")}-bug-fix`);
    expect(isOwnedBranch(owned, "root-session-1")).toBe(true);
    expect(isOwnedBranch(owned, "root-session-2")).toBe(false);
    expect(() => ownedBranchName(owned, "root-session-2")).toThrow(/different agent session/);
  });

  it.each(["/absolute", "../escape", ".git/config", "a//b", "line\nbreak"])(
    "rejects unsafe changed path %s",
    (path) => expect(validateChangedPath(path)).not.toBeNull(),
  );

  it("computes the canonical Git blob id for published bytes", () => {
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});

describe("private scoped storage", () => {
  it("keeps managed documents private", () => {
    expect(DOCUMENT_ACCESS).toBe("private");
  });

  it("uses UUID artifact ids and scopes keys to the root session", () => {
    const id = artifactId("analysis", "Fix retries");
    expect(id).toMatch(/^analysis-fix-retries-[a-f0-9-]{36}$/);
    const firstScope = artifactScope("root-1");
    const secondScope = artifactScope("root-2");
    expect(artifactKey(id, firstScope)).toContain(`${firstScope}/${id}.md`);
    expect(artifactKey(id, secondScope)).not.toBe(artifactKey(id, firstScope));
    expect(artifactKey("../factory-brain", firstScope)).toBeNull();
  });

  it("scopes review attestations to the root session and branch", () => {
    expect(reviewAttestationKey("root-1", "eve/a")).not.toBe(
      reviewAttestationKey("root-2", "eve/a"),
    );
    expect(reviewAttestationKey("root-1", "eve/a")).not.toBe(
      reviewAttestationKey("root-1", "eve/b"),
    );
  });

  it("scopes unattended intake latches to one repository issue", () => {
    expect(intakeLatchKey(17)).toBe(intakeLatchKey(17));
    expect(intakeLatchKey(17)).not.toBe(intakeLatchKey(18));
    expect(intakeLatchKey(17)).toMatch(/^intake-latches\/[a-f0-9]{64}\.json$/);
  });

  it.each([
    [null, null, false],
    ["a".repeat(40), null, false],
    [null, "a".repeat(40), false],
    ["a".repeat(40), "b".repeat(40), false],
    ["a".repeat(40), "a".repeat(40), true],
  ])("requires matching non-null review and remote SHAs", (attested, remote, expected) => {
    expect(isReviewedRemoteCommit(attested, remote)).toBe(expected);
  });

  it("claims, races, and clears an intake latch through atomic no-overwrite storage", async () => {
    const write = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const storage: IntakeLatchStorage = {
      delete: remove,
      read: vi.fn(async () => ({ found: false })),
      write,
    };

    await expect(claimIntakeLatch(17, "delivery-1", storage)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(
      intakeLatchKey(17),
      expect.stringContaining('"deliveryId":"delivery-1"'),
      { allowOverwrite: false },
    );
    await clearIntakeLatch(17, storage);
    expect(remove).toHaveBeenCalledWith(intakeLatchKey(17));

    const racedStorage: IntakeLatchStorage = {
      delete: remove,
      read: vi
        .fn<() => Promise<{ found: boolean }>>()
        .mockResolvedValueOnce({ found: false })
        .mockResolvedValueOnce({ found: true }),
      write: vi.fn(async () => {
        throw new Error("precondition failed");
      }),
    };
    await expect(claimIntakeLatch(18, "delivery-2", racedStorage)).resolves.toBe(false);
  });
});
