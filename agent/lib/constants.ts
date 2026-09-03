/**
 * The repository the factory works on, as `owner/repo`.
 *
 * @remarks
 * The checked-in default belongs to diff0's own deployment. Forks override it
 * with `FACTORY_REPO`. Every surface reads this one constant.
 */
if (process.env.VERCEL === "1" && !process.env.FACTORY_REPO) {
  throw new Error("FACTORY_REPO must be set for a Vercel deployment.");
}
export const FACTORY_REPO = process.env.FACTORY_REPO ?? "knowbody/diff0";

// GitHub's own naming rules: owner is alphanumeric with inner hyphens, repo
// adds dots and underscores. Catching a malformed value here fails discovery
// with a clear message instead of a cryptic clone error at template build.
const FACTORY_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

if (!FACTORY_REPO_PATTERN.test(FACTORY_REPO)) {
  throw new Error(
    `FACTORY_REPO must reference an existing GitHub repository in owner/repo format (e.g. 'knowbody/diff0'), got '${FACTORY_REPO}'.`,
  );
}

const [factoryOwner = "", factoryRepoName = ""] = FACTORY_REPO.split("/");

/**
 * {@link FACTORY_REPO} split into the `owner` / `repo` fields GitHub tools
 * take, validated at module load.
 */
export const factoryRepo = { owner: factoryOwner, repo: factoryRepoName };

/**
 * The GitHub label that hands an issue to the factory. Overridable with the
 * `FACTORY_LABEL` environment variable.
 *
 * @remarks
 * Applying it requires triage permission on the repository, so the trigger is
 * maintainer-initiated even though the resulting run is unattended.
 */
export const FACTORY_LABEL = process.env.FACTORY_LABEL ?? "eve-build";

/**
 * Branch-name prefix for the factory's own feature branches. Overridable
 * with the `FACTORY_BRANCH_PREFIX` environment variable.
 *
 * @remarks
 * The implementer names its branches `eve/<type>-<slug>`; the GitHub
 * trusted publishing code combines this prefix with a root-session ownership
 * token, preventing one session from updating another session's branch.
 */
export const FACTORY_BRANCH_PREFIX = process.env.FACTORY_BRANCH_PREFIX ?? "eve/";

const FACTORY_BRANCH_PREFIX_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9/])?$/;

if (
  !FACTORY_BRANCH_PREFIX_PATTERN.test(FACTORY_BRANCH_PREFIX) ||
  !FACTORY_BRANCH_PREFIX.endsWith("/") ||
  FACTORY_BRANCH_PREFIX.includes("..") ||
  FACTORY_BRANCH_PREFIX.includes("//")
) {
  throw new Error(
    `FACTORY_BRANCH_PREFIX must be a non-empty, plain branch namespace ending in "/" (e.g. "eve/"), got '${FACTORY_BRANCH_PREFIX}'.`,
  );
}
