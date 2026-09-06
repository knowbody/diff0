# Upstream provenance

The factory started from Vercel Labs' MIT-licensed
[Eve Software Factory template](https://github.com/vercel-labs/eve-software-factory-template)
at commit `0d630a284b84e5be38fe7eceec7b231a7e79bfd0` (2026-08-20).

The diff0 adaptation:

- targets `knowbody/diff0` and uses `eve-build` / `eve/*` for intake and branches;
- uses GitHub as the primary intake and delivery surface;
- requires diff0's own typecheck, lint, test, build, and deterministic behavioral comparison;
- keeps pull requests draft until a person marks them ready, and exposes no merge tool;
- tracks Eve `0.47.5`, the same version used by the diff0 repository.

When pulling upstream changes, review the trust, approval, sandbox credential-brokering, and
non-mutating eval boundaries before resolving mechanical differences.

The installed `@github-tools/eve-extension` 0.3.2 supplies SDK formatter closures without Eve
durable descriptors. Eve 0.47.5 rejects the whole dynamic tool set when one callback is invalid.
The directory mount at `extensions/github/` overrides its dynamic tool resolver to read the
app's options directly, avoiding the package's dependency-layout-sensitive ambient config binding.
`lib/github/runtime-callbacks.ts` supplies authored output formatters and separate approval
callbacks per mounted tool. It preserves content/patch truncation and delegates authorization
to `lib/github/approval.ts`. The helper definitions are not mounted as tools.

Keep the connector-free `safety/write-requires-approval` eval in the PR comparison: it proves
GitHub tools resolve and a write parks before execution. Greeting and prompt-injection evals
alone can pass even when the entire GitHub tool set is missing.
