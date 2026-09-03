# Deterministic test mode

diff0 ships a deterministic Eve fixture under [`fixtures/demo-agent`](../fixtures/demo-agent).
It exercises the real Eve runtime, tools, skill loading, subagent delegation, worktree setup, and
reporting pipeline without calling a hosted model.

This keeps pull-request checks repeatable and prevents model credentials from being exposed to code
from an unreviewed ref.

## Run the checks

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:integration
```

The unit suite is the fast default. The integration suite creates temporary Git repositories and
runs the fixture through real `eve eval` processes, so it is intentionally separate and slower.

## Demo model selection

The fixture reads `DIFF0_DEMO_MODEL`:

| Value | Behavior |
| --- | --- |
| `mock` | Always use Eve's deterministic mock model. Integration tests set this explicitly. |
| Unset | Use the mock when no gateway credential exists; otherwise use the fixture's documented gateway model. |
| Any other value | Use that value as an AI Gateway model id. |

A mock run identifies itself as `eve-mock/mock-revenue-analyst`; it never masquerades as a
hosted-model result.

## Running a real-model comparison

Run credentialed comparisons only after reviewing both refs, preferably in a disposable,
network-restricted environment:

```sh
export AI_GATEWAY_API_KEY=your_key
export DIFF0_DEMO_MODEL=anthropic/claude-haiku-4.5

pnpm build
node dist/cli.js estimate --repo . --app-dir fixtures/demo-agent --base main --head HEAD --runs 3 \
  --max-spend 1
node dist/cli.js run --repo . --app-dir fixtures/demo-agent --base main --head HEAD --runs 3 \
  --max-spend 1
```

The fixture is test infrastructure. Its automatic model selection is convenient for local
experiments, but production repositories should configure their own Eve models and evals.

## Public real-model example

[Showcase PR #8](https://github.com/knowbody/diff0/pull/8) demonstrates the same fixture under the
real `anthropic/claude-haiku-4.5` model for 10 runs per ref. The bot-authored report is the
authoritative evidence: it records 59/60 passing eval observations, confirmed `reporter` drift,
and unavailable comparison cost where delegated base usage could not be attributed.

The repository's [dogfood workflow](../.github/workflows/diff0.yml) exposes its capped gateway
credential only when both the PR author and triggering actor are the repository owner. That is a
repository-specific trust policy, not a general assurance that same-repository branches are safe.

## Security boundary

diff0 executes application and eval code from both refs. A malicious ref can read credentials
available to the eval process even when dependency lifecycle scripts are disabled. Do not expose
provider, cloud, registry, or GitHub credentials to untrusted pull-request code. See the
[CI trust boundary](../README.md#ci-trust-boundary) for the complete guidance.
