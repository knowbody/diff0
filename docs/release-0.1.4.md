# v0.1.4 release preparation

Status: prepared in source; publishing npm, the Git tag/release, and the website are
separate release steps. Do not announce availability until they are verified.

## Changes since v0.1.3

- Performance budgets compare unrounded measurements, so a 10.04% duration increase
  exceeds a 10% limit even when the displayed percentage rounds to 10%.
- Commander 14 restores the declared Node.js 20 support. The pnpm packaging hook
  excludes Eve, which belongs to this repository's maintenance agent, from the CLI tarball.
- Inconclusive behavioral observations stay in report details without independently
  triggering yellow or drift enforcement. Confirmed drift and other findings still gate.
- The package includes the preview library API: comparison, runner, Eve adapter,
  and reporters entrypoints.
- Website onboarding links to baseline, eval, and credential setup. September 4's
  showcase keeps its original v0.1.3 label and a preserved console-report excerpt;
  the refreshed live PR is linked separately.

## Publish after review and merge

Use the merged commit for both npm and the Action tag. These commands publish public
artifacts and are intended for the maintainer performing the release.

1. Check out the merged commit with a clean tree. Run `corepack enable` and
   `pnpm install --frozen-lockfile` (package.json pins pnpm 10.28.0).
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`,
   `pnpm test:package`, and `pnpm action:build`. Confirm
   `git diff --exit-code -- action/dist`. Run the website build, typecheck, and tests
   from `website/`, and require green CI on the merged commit (including Node 20
   engine-strict installation).
3. Run `pnpm pack --out /tmp/knowbody-diff0-0.1.4.tgz` and inspect the tarball manifest: version `0.1.4`, Commander 14,
   Node `>=20`, all four library exports, and no Eve runtime dependency.
4. Publish with `pnpm publish --access public`. Use pnpm, not npm, so the packaging
   hook runs. Verify `npm view @knowbody/diff0@0.1.4 version engines dependencies`
   and smoke-test `npx @knowbody/diff0@0.1.4 --help` in a fresh directory.
5. Create and push tag `v0.1.4` at that same verified commit, then create its GitHub
   release. Check `knowbody/diff0/action@v0.1.4` resolves to that commit and contains
   the checked-in Action bundles. Never move an existing release tag.
6. Deploy the website and verify the archived report, Getting Started link, and
   v0.1.4 workflow example on diff0.io. The website changes should go live once
   npm and the Action tag exist; do not announce during a partial release.

The release requires maintainer npm publishing access and GitHub tag/release access.
No new real-model run is needed to support the historical September 4 figures; a
claim about the latest live comparison must use that comparison's completed result.
