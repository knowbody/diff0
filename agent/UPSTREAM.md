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
