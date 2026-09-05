# diff0

**git diff shows what changed in the code. diff0 shows what changed in the agent.**

diff0 compares an [Eve](https://eve.dev) agent across two committed Git refs. It runs each ref's
Eve eval suite several times, then reports changes in eval results, tool calls, skills, subagents,
outputs, tokens, attributable cost, and duration. If evaluator files changed too, diff0 marks the
comparison as confounded and will not produce a red verdict.

Use it locally from any Git repository that contains an Eve app and evals:

```sh
npx @knowbody/diff0 run --base main
```

That compares `main` with your committed `HEAD`. Nothing is installed globally and your working
tree is not modified. A dirty `HEAD` is rejected so uncommitted edits cannot be silently omitted
from the result.

## Why use it?

An eval can stay green while the agent changes how it reaches the answer. A prompt edit might stop
using a tool, skip a specialist subagent, or make each run slower without changing the final score.
diff0 makes those changes visible in the terminal and in your pull request.

[Showcase PR #15](https://github.com/knowbody/diff0/pull/15) is the public, inspectable example:

| What changed | What the run found |
| --- | --- |
| One instruction was simplified | The `reporter` subagent went from 10/10 to 0/10 uses in each of three evals |
| The real model ran 10 times per ref | All 60 base and head eval observations passed; no confirmed regression |
| Agent behavior became simpler | Median output tokens fell 34% and captured eval duration fell 41% |

The workflow called `anthropic/claude-haiku-4.5`; the bot-authored report, source diff, and Action
logs remain open for inspection. Cost is marked unavailable because delegated base usage was not
fully attributed, so diff0 does not claim a cost saving.

![Current diff0 CLI demo showing a real-model behavioral comparison after delegated reporting is replaced with a direct summary](https://raw.githubusercontent.com/knowbody/diff0/main/demo/demo.gif)

_Recorded with diff0 v0.1.3, Eve 0.47.5, and `anthropic/claude-haiku-4.5`. The terminal demo uses
five runs per ref; [PR #15](https://github.com/knowbody/diff0/pull/15) contains the corresponding
10-run GitHub Actions comparison._

## Quick start

Run a comparison:

```sh
npx @knowbody/diff0 run --base main
```

Estimate the cost and duration first:

```sh
npx @knowbody/diff0 estimate --base main
```

Use `bunx` instead of `npx` if you use Bun. For repeated local use, install
`@knowbody/diff0` as a development dependency.

### Requirements

- Node.js 20 or newer for the diff0 CLI.
- Linux or macOS. Windows is not supported yet.
- Git and the package manager used by the target repository.
- An Eve app with an `evals/` suite. Current Eve releases require Node.js 24 or newer.
- The model credentials your eval suite normally uses.

If the repository has no evals, diff0 exits with a small copy-pasteable starter suite.

## Add it to a pull request

Create `.github/workflows/diff0.yml` in your agent repository:

```yaml
name: diff0

on:
  pull_request:
    # Run only when agent behavior could change. Edit these paths for your repo.
    paths:
      - "agent/**"
      - "evals/**"
      - "src/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - ".github/workflows/diff0.yml"

permissions:
  contents: read
  pull-requests: write

jobs:
  diff0:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - uses: knowbody/diff0/action@v0.1.3
        with:
          working-directory: .
          runs: "3"
          install-mode: scripts-off
          fail-on: regression # yellow drift reports but does not block; use drift to gate it
```

The Action posts one report comment and updates it on each push. `paths` prevents README-only and
other irrelevant changes from spending model budget. If this workflow is a required check, read
the [Action guide](https://github.com/knowbody/diff0/blob/main/action/README.md#choose-when-diff0-runs)
before using path filters; GitHub can leave a skipped required workflow pending.

The job also needs whichever model credential your eval suite normally uses. Add it only after
deciding which pull-request authors and branches you trust with that credential.

## What the report means

diff0 checks both refs out into temporary worktrees and counterbalances repeated runs (AB, then BA)
to reduce systematic run-order bias. It then separates three outcomes:

- **Green:** no regression or review-worthy drift was found.
- **Yellow:** behavior changed, results were flaky or incomplete, or the evidence is inconclusive.
- **Red:** an eval regression crossed the release gate.

The report includes:

- eval pass proportions and scorer changes;
- skill, subagent, tool-call, and output drift;
- tokens, attributable cost, and duration;
- the model, Eve version, run counts, actual sandbox as unknown, and the separately labeled host-default sandbox candidate; and
- uncertainty instead of treating one nondeterministic run as proof.

Tool inputs and final outputs are fingerprinted. Raw values and reusable hashes are not included in
public reports.

The comparison uses captured eval JSON/events and privacy-preserving fingerprints; diff0 disables
Eve traces. It does not prove semantic equivalence, judge whether drift is desirable, or isolate
the model/provider from external state. Changes under the selected app's `evals/` directory,
authored sandbox configuration, and additional `--validity-path` globs are called out as validity
mismatches because the two refs may then be measuring different standards or runtime conditions.

For the statistical rules, JSON schema, exit codes, and full option list, read the
[CLI contract](https://github.com/knowbody/diff0/blob/main/docs/cli-contract.md).

## Common options

```text
diff0 run --base <ref> [--head <ref>] [options]

--runs <n>              runs per ref (default: 3)
--evals <filter>        run selected eval ids or prefixes
--app-dir <path>        Eve app path inside a monorepo
--validity-path <glob>  add an evaluator/config validity glob
--max-spend <usd>       stop after measured spend crosses the threshold
--max-duration-increase-pct <pct>  override the duration regression budget
--cache                 reuse fresh base runs for 24 hours
--fail-on <policy>      legacy policy or comma-separated granular categories
--report-md <path>      write a Markdown report
--report-json <path>    write a machine-readable report
```

`--validity-path` is repeatable or comma-separated and adds to the built-in `<app>/evals/**`
validity check. Granular enforcement categories are `eval-regression`, `score-regression`,
`performance-regression`, `behavioral-drift`, and `comparison-validity`; legacy `regression`,
`drift`, and `never` remain supported.

Directional median-increase budgets default to 25% for cost and 100% for uncached input tokens,
output tokens, and duration. The four `--max-*-increase-pct` flags override individual defaults;
improvements never violate a budget.

`diff0 estimate` performs at most one eval-suite pass and projects the full comparison. It accepts
the same `--timeout` and `--max-concurrency` execution controls as `run`. The default
run count is three; use five or more when you need stronger evidence and can afford the extra model
runs.

## Cost controls

A comparison runs the eval suite on both refs, so model spend scales with the number of runs.

- Start with `diff0 estimate`.
- Use `--evals` to select only relevant evals.
- Set `--max-spend` in CI.
- Add `--cache` during iteration to reuse a fresh base result; omit it for a fresh release gate.
- Configure workflow `paths` so documentation-only changes do not run diff0.

Unavailable cost is always shown as unavailable, never `$0`.
`--max-spend` is checked after each atomic suite run, so the final measured spend can exceed the
threshold by one suite run. If Eve reports no attributable cost and the model is not priced in
diff0's table, the threshold cannot be enforced.

## Use as a library

The package exposes a pure comparison engine, a Node.js execution runner, an Eve
adapter, and report renderers. Use `compareRefs` from `@knowbody/diff0/runner` for
the complete workflow, or `computeDelta` from `@knowbody/diff0` with records collected
by your own host. The CLI uses the same comparison entrypoint.

See [Library API](docs/library-api.md) for examples, input contracts, and publishing
structured reports without exposing internal fingerprints.

## Eve compatibility

The end-to-end suite targets Eve `0.47.5`; parsing fixtures also cover result identity from Eve
`0.29.5`. Other Eve versions may work, but they are not part of the tested compatibility boundary.

## Security

diff0 installs dependencies and executes the app, tools, subagents, and eval code from **both Git
refs**. It is an execution harness, not a security sandbox.

- Do not expose credentials to untrusted pull-request code.
- Keep the default `install-mode: scripts-off` unless both refs are trusted.
- Use `persist-credentials: false` with `actions/checkout`; the Action refuses persisted checkout
  credentials.
- Fork and `pull_request_target` runs are refused by default.

For untrusted contributions, use a disposable, network-restricted, secret-free runner or run a
protected comparison after review. See the [Action security guide](https://github.com/knowbody/diff0/blob/main/action/README.md#security-and-fork-prs)
and [deterministic CI guide](https://github.com/knowbody/diff0/blob/main/docs/credential-free-ci.md).

## This repository's Eve agent

The `agent/` directory contains the Eve agent that helps maintain diff0. It is based on the public
Eve Software Factory pattern and uses classifier, analyst, implementer, and independent reviewer
stages. It can open reviewed draft pull requests, but it cannot merge or mark them ready.

Read [agent/README.md](https://github.com/knowbody/diff0/blob/main/agent/README.md) for its trust
boundaries, local validation, and deployment instructions.

## Contributing

```sh
git clone https://github.com/knowbody/diff0
cd diff0
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
```

See [CONTRIBUTING.md](https://github.com/knowbody/diff0/blob/main/CONTRIBUTING.md) for the complete
development workflow. Security issues should be reported privately as described in
[SECURITY.md](https://github.com/knowbody/diff0/blob/main/SECURITY.md).

MIT licensed.
