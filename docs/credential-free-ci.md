# Deterministic test mode

diff0 ships a deterministic Eve fixture under [`fixtures/demo-agent`](../fixtures/demo-agent).
It exercises the real Eve runtime, tools, skill loading, subagent delegation, worktree setup, and
reporting pipeline without calling a hosted model.

This keeps pull-request checks repeatable and prevents model credentials from being exposed to code
from an unreviewed ref.

## Run the checks

The **diff0 deterministic** workflow runs when a PR opens, reopens, or receives new commits and
its diff changes the demo agent's runtime, prompts, skills, evals, package/lockfile, or TypeScript
configuration. This includes Eve-authored PRs. It compares the actual PR base and head using
the demo fixture with `DIFF0_DEMO_MODEL=mock`, three runs per ref, and regression enforcement.
The report appears in the Actions run summary and downloadable artifacts. It receives no model
or connector credentials and cannot post PR comments. GitHub may require a maintainer to approve
workflow execution for a first-time fork contributor.

This checks the deterministic fixture and diff0 pipeline. It does not measure the maintenance
agent's real-model behavior; those paid comparisons retain their separate approval policy.
The `skip-paid-evals` label does not skip this workflow. GitHub Actions usage still applies,
but there are no model API charges.

Comparison triggers follow the evaluated app:

| Changed files | Automatic comparison |
| --- | --- |
| Demo-agent runtime, instructions, skills, evals, dependencies or config | Deterministic demo; paid demo only under its existing owner/budget policy |
| Maintenance-agent runtime, prompts, skills, dependencies, config or selected evals | Paid maintenance comparison only under its existing owner/budget policy |
| Website, ordinary documentation, CLI, reporting, Action bundle or unrelated tests | No agent comparison; ordinary CI still runs |
| A comparison's own workflow | That comparison, to validate its setup; payment rules still apply |

Prompt and skill Markdown are agent inputs and are intentionally included. Ordinary README,
cost/run notes, and unselected maintenance evals are excluded. Changes to evaluators can make
the comparison invalid rather than demonstrate a behavioral regression. The deterministic demo
does not provide coverage of maintenance-agent changes or compare two versions of the diff0 CLI.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:package
pnpm test:integration
```

The unit suite is the fast default. The package suite builds an npm tarball and installs it
in an isolated TypeScript consumer to check the published entrypoints, declarations, and report
contract. It requires npm registry access, but does not run Eve or need model credentials.
The integration suite creates temporary Git repositories and
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

[Showcase PR #15](https://github.com/knowbody/diff0/pull/15) demonstrates the same fixture under the
real `anthropic/claude-haiku-4.5` model for 10 runs per ref. The bot-authored report is the
primary public evidence: it records 60/60 passing eval observations, confirmed `reporter` drift,
and unavailable comparison cost where delegated base usage could not be attributed.

The repository's [dogfood workflow](../.github/workflows/diff0.yml) exposes its capped gateway
credential only when both the PR author and triggering actor are the repository owner. That is a
repository-specific trust policy, not a general assurance that same-repository branches are safe.

## Security boundary

diff0 executes application and eval code from both refs. A malicious ref can read credentials
available to the eval process even when dependency lifecycle scripts are disabled. Do not expose
provider, cloud, registry, or GitHub credentials to untrusted pull-request code. See the
[CI trust boundary](../README.md#ci-trust-boundary) for the complete guidance.
