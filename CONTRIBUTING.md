# Contributing to diff0

## Setup

Node >= 24 (eve's floor; the CLI itself runs on >= 20), pnpm via corepack. Then:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm agent:info
```

The integration tests spawn real `eve eval` runs with a mock model and no credentials.
Everything Eve-specific lives behind [src/adapters/eve.ts](src/adapters/eve.ts). Unit tests cover
the older `0.29.5` result identity and current `0.47.5`'s `eve info` model fallback; keep both paths
when changing the adapter.

## Deterministic fixtures

diff0's regression suite runs against small deterministic agent repositories with known drift
injected. [fixtures/demo-agent](fixtures/demo-agent) is a
revenue-analyst eve agent whose mock model is context-sensitive to its instructions, so tests can
delete a rule on a branch and assert that diff0 reports exactly the resulting behavioral delta
(a skill load disappearing, a subagent delegation dropping from 5/5 runs to 0/5) while all evals
stay green. Tests copy a fixture into a scratch git repo, commit base and head refs, and run the
real pipeline end to end — worktrees, installs, `eve eval`, report. New drift shapes (tool-order
changes, cost regressions, flaky evals) should arrive as new fixtures or new branches of existing
ones, never as mocks of diff0's own internals.

## Ground rules

- Run the setup commands above before opening a PR.
- The honest-framing rules are load-bearing product behavior, not style: proportions over
  absolutes, Fisher + Holm evidence before calling an eval regressed or improved, uncertainty
  stated explicitly, and unknown cost never rendered as $0. Tests encode them; don't weaken them.
- Paper-inspired features must be implemented from primary literature and independently written,
  not copied from another implementation.
