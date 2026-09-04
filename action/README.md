# diff0 GitHub Action

git diff tells you what changed in the code. diff0 tells you what changed in the agent.

This composite action runs `diff0 run` between the PR base and head, then upserts one sticky PR
comment for that invocation. The default report uses the `<!-- diff0-report -->` marker; an
optional `comment-key` gives parallel comparisons independent markers. Each report is edited in
place on every push, never spammed. Verdict enforcement happens **after** the comment is posted.
If the CLI launches but cannot produce a report, the old comment is replaced with a current failure
summary. Trust-boundary and input-validation failures happen earlier and intentionally stop before
any comment API call.

The action ships a checked-in CLI bundle. Consumers do **not** install diff0: `uses:` is all it
takes. There are zero third-party action dependencies (run steps only). Bundled library licenses
are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

[Showcase PR #15](https://github.com/knowbody/diff0/pull/15) is a permanent real-model example of
the Action in use: 10 runs per ref on `anthropic/claude-haiku-4.5`, an owner-gated credential,
one bot-authored sticky report, and no mock evidence presented as production output.

## Usage

```yaml
name: diff0

on:
  pull_request:
    # Only compare changes that can affect the agent or its evals.
    # Edit these paths to match your repository.
    paths:
      - "agent/**"
      - "evals/**"
      - "src/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - ".github/workflows/diff0.yml"

permissions:
  contents: read
  pull-requests: write # required for the sticky PR comment

jobs:
  diff0:
    runs-on: ubuntu-latest
    steps:
      # fetch-depth: 0 is REQUIRED — diff0 checks the base ref out into a
      # worktree, and a shallow clone does not contain it.
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          # diff0 executes code from both refs. Do not leave the job token in
          # Git config where evaluated head code can read it.
          persist-credentials: false

      # Node 24 runs both the diff0 CLI and current Eve releases.
      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - uses: knowbody/diff0/action@v0.1.3
        with:
          working-directory: . # path of your eve app within the repo
          runs: "3"
          install-mode: scripts-off
          fail-on: regression # yellow drift reports but does not block; use drift to gate it
```

### Choose when diff0 runs

The `paths` list above uses GitHub's native pull-request filtering. Add every prompt, tool, eval,
model configuration, dependency manifest, or other file that can affect agent behavior. Remove the
filter to compare every pull request. With the filter in place, a README-only change does not spend
time or model budget on a behavioral comparison.

GitHub warns that a required workflow skipped by a path filter can remain pending and block a pull
request. If `diff0` is a required status check, keep this workflow unconditional or make a separate
always-running gate the required check and conditionally run the diff0 job behind it.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `base` | PR base SHA | Base ref |
| `head` | PR head SHA | Head ref |
| `runs` | `3` | Runs per ref |
| `evals` | all | Eval filter |
| `validity-paths` | none | Comma-separated additive repo-relative evaluator/config globs |
| `install-mode` | `scripts-off` | Disable install scripts (scripts-off) or allow them for reviewed refs (scripts-on) |
| `fail-on` | `regression` | One legacy policy or comma-separated granular enforcement categories |
| `max-spend` | none | Measured-cost stop threshold; checked after each suite run and may overshoot by one run; unavailable cost cannot be enforced |
| `max-cost-increase-pct` | core default (`25`) | Maximum directional median cost increase |
| `max-input-token-increase-pct` | core default (`100`) | Maximum directional median uncached-input-token increase |
| `max-output-token-increase-pct` | core default (`100`) | Maximum directional median output-token increase |
| `max-duration-increase-pct` | core default (`100`) | Maximum directional median duration increase |
| `working-directory` | `.` | Where the eve app lives (maps to CLI `--app-dir`; the repo root is always the workflow checkout) |
| `github-token` | `${{ github.token }}` | For the sticky comment (needs `pull-requests: write`) |
| `comment-key` | empty | Stable key for a separate sticky report when one PR compares multiple Eve apps |
| `allow-untrusted-head` | `false` | Execute fork/`pull_request_target` head code; only for isolated secret-free jobs |

The former `safe` and `trusted` values remain accepted as deprecated aliases for `scripts-off`
and `scripts-on`, respectively.

For a selective quality/performance gate without blocking every behavioral difference:

```yaml
with:
  fail-on: eval-regression,score-regression,performance-regression,comparison-validity
  max-duration-increase-pct: "50"
  validity-paths: src/scorers/**,packages/eval-utils/**
```

Set `comment-key` when one pull request compares more than one Eve app. Each key gets its own
sticky comment; reruns update only the matching report. Leaving it empty preserves the original
`<!-- diff0-report -->` marker and behavior.

## Outputs

| Output | Meaning |
| --- | --- |
| `verdict` | `green` \| `yellow` \| `red` (empty if the CLI failed before reporting) |
| `exit-code` | Raw CLI exit code |
| `report-md` / `report-json` | Paths to the generated reports on the runner |

For reports that may exceed GitHub's comment limit, give the diff0 step an `id` and upload both
`steps.<id>.outputs.report-md` and `steps.<id>.outputs.report-json` with your artifact step. The
sticky comment truncates only at a line boundary and explains how to retain the full file; workflow
runner files do not persist after the job by themselves.

## How the check outcome is decided

The CLI itself always runs with `--fail-on never` so the report and PR comment land first.
Then the action enforces the `fail-on` **input**:

- CLI exit `2` (config error), `3` (execution error), or `4` (`max-spend` exceeded) always
  fail the check, under every policy.
- `fail-on: regression` (default) — fail on a `red` verdict; drift alone (`yellow`) passes.
- `fail-on: drift` — fail on `red` or `yellow`.
- `fail-on: never` — never fail on the verdict (execution errors still fail).
- A comma-separated granular selection fails when any selected schema-4 enforcement category is
  present: `eval-regression`, `score-regression`, `performance-regression`, `behavioral-drift`, or
  `comparison-validity`.

Legacy and granular names cannot be mixed. Performance budgets are directional: improvements do
not fail. Empty budget inputs use the core defaults; explicit values override one metric. The
`validity-paths` input adds to the built-in selected-app `evals/**` validity check.

The report records the actual Eve sandbox as `unknown`, because Eve does not expose it, and shows
the host-default sandbox candidate separately. A changed authored sandbox configuration is a
comparison-validity warning.

## Requirements

- `actions/checkout` with `fetch-depth: 0` and `persist-credentials: false` before this action. The
  Action fails closed for both legacy persisted HTTP headers and checkout v7's `includeIf`
  credential config.
- `actions/setup-node` with Node 24 before this action when using current Eve releases. The
  diff0 CLI itself supports Node >= 20. The action enables Corepack for pnpm and Yarn targets.
- A Linux or macOS runner. Install Bun before this action when the target app uses a Bun lockfile.
- The model credentials required by the target eval suite, unless it deliberately uses a local or
  deterministic model. Expose credentials only after applying the trust guidance below.
- `permissions: pull-requests: write` for the comment (the comment step is skipped on
  non-`pull_request` events).

## Security and fork PRs

diff0 installs dependencies and executes eval, tool, subagent, and application code from both Git
refs. Installs are lockfile-frozen; the default `install-mode: scripts-off` disables lifecycle/build
scripts. `install-mode: scripts-on` permits those scripts for applications that need them. Both modes
scrub credential-shaped install environment variables and use an isolated home; registry
auth/config remains available for private packages and is therefore accessible to scripts-on mode
install scripts. This is still not a sandbox: head-controlled
eval and runtime code can read credentials intentionally exposed to the eval job.

- Fork PRs and `pull_request_target` are refused by default. Same-repository branches still require
  your normal contributor trust review.
- Do not use `pull_request_target` to make secrets or a write token available while executing the
  PR head.
- For untrusted contributions, use a disposable network-restricted runner with no secrets and a
  deterministic mock. Only then, if you accept the risk, set `allow-untrusted-head: true`.
- Run credentialed real-model comparisons from a protected/manual workflow after review, or use a
  narrow repository-owner gate with a separately capped provider key. The
  [diff0 dogfood workflow](https://github.com/knowbody/diff0/blob/main/.github/workflows/diff0.yml)
  is a concrete example; do not copy its trust decision unless only the owner can satisfy it.
- The Action exports its `github-token` input only to the sticky-comment step. Checkout is a
  separate token path: without `persist-credentials: false`, it leaves the job token readable in
  Git config by evaluated head code. Fork comments are skipped because the ordinary
  `pull_request` token is read-only.
