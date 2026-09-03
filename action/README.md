# diff0 GitHub Action

git diff tells you what changed in the code. diff0 tells you what changed in the agent.

This composite action runs `diff0 run` between the PR base and head, then upserts one sticky PR
comment for that invocation. The default report uses the `<!-- diff0-report -->` marker; an
optional `comment-key` gives parallel comparisons independent markers. Each report is edited in
place on every push, never spammed. The check outcome is decided by the `fail-on` input **after**
the comment is posted, so you always get the report even when the check fails.

The action ships a checked-in CLI bundle. Consumers do **not** install diff0: `uses:` is all it
takes. There are zero third-party action dependencies (run steps only). Bundled library licenses
are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Usage

```yaml
name: diff0

on: pull_request

permissions:
  contents: read
  pull-requests: write # required for the sticky PR comment

jobs:
  diff0:
    runs-on: ubuntu-latest
    steps:
      # fetch-depth: 0 is REQUIRED — diff0 checks the base ref out into a
      # worktree, and a shallow clone does not contain it.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          # diff0 executes code from both refs. Do not leave the job token in
          # Git config where evaluated head code can read it.
          persist-credentials: false

      # Node 24 runs both the diff0 CLI and current Eve releases.
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - uses: knowbody/diff0/action@v0.1.0
        with:
          working-directory: . # path of your eve app within the repo
          runs: "3"
          install-mode: scripts-off
          fail-on: regression
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `base` | PR base SHA | Base ref |
| `head` | PR head SHA | Head ref |
| `runs` | `3` | Runs per ref |
| `evals` | all | Eval filter |
| `install-mode` | `scripts-off` | Disable install scripts (scripts-off) or allow them for reviewed refs (scripts-on) |
| `fail-on` | `regression` | `regression` \| `drift` \| `never` — when to fail the check |
| `max-spend` | none | USD cap passed through |
| `working-directory` | `.` | Where the eve app lives (maps to CLI `--app-dir`; the repo root is always the workflow checkout) |
| `github-token` | `${{ github.token }}` | For the sticky comment (needs `pull-requests: write`) |
| `comment-key` | empty | Stable key for a separate sticky report when one PR compares multiple Eve apps |
| `allow-untrusted-head` | `false` | Execute fork/`pull_request_target` head code; only for isolated secret-free jobs |

The former `safe` and `trusted` values remain accepted as deprecated aliases for `scripts-off`
and `scripts-on`, respectively.

Set `comment-key` when one pull request compares more than one Eve app. Each key gets its own
sticky comment; reruns update only the matching report. Leaving it empty preserves the original
`<!-- diff0-report -->` marker and behavior.

## Outputs

| Output | Meaning |
| --- | --- |
| `verdict` | `green` \| `yellow` \| `red` (empty if the CLI failed before reporting) |
| `exit-code` | Raw CLI exit code |
| `report-md` / `report-json` | Paths to the generated reports on the runner |

## How the check outcome is decided

The CLI itself always runs with `--fail-on never` so the report and PR comment land first.
Then the action enforces the `fail-on` **input**:

- CLI exit `2` (config error), `3` (execution error), or `4` (`max-spend` exceeded) always
  fail the check, under every policy.
- `fail-on: regression` (default) — fail on a `red` verdict; drift alone (`yellow`) passes.
- `fail-on: drift` — fail on `red` or `yellow`.
- `fail-on: never` — never fail on the verdict (execution errors still fail).

## Requirements

- `actions/checkout` with `fetch-depth: 0` and `persist-credentials: false` before this action. The
  Action fails closed when checkout's persisted HTTP auth header is present.
- `actions/setup-node` with Node 24 before this action when using current Eve releases. The
  diff0 CLI itself supports Node >= 20. The action enables Corepack for pnpm and Yarn targets.
- A Linux or macOS runner. Install Bun before this action when the target app uses a Bun lockfile.
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
- Run credentialed real-model comparisons from a protected/manual workflow after review.
- The Action exports its `github-token` input only to the sticky-comment step. Checkout is a
  separate token path: without `persist-credentials: false`, it leaves the job token readable in
  Git config by evaluated head code. Fork comments are skipped because the ordinary
  `pull_request` token is read-only.
