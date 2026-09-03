# diff0

**git diff tells you what changed in the code. diff0 tells you what changed in the agent.**

Behavioral diff for AI agents built on [eve](https://eve.dev). Catch your agent's drift.

![diff0 demo — git diff shows two deleted instruction lines, eve eval passes on the head branch, diff0 flags a YELLOW verdict on claude-haiku-4.5: the reporter subagent ran in 5 of 5 base runs but 0 of 5 head runs, with session cost down about a third](https://raw.githubusercontent.com/knowbody/diff0/main/demo/demo.gif)

diff0 checks two git refs out into isolated worktrees and runs your repo's own eve eval suite N
times per ref (default 3, interleaved). It then computes an evidence-qualified delta: statistical
eval/skill/subagent comparisons, stable repeated tool/output changes, and cost/latency movement —
with sampling uncertainty and within-ref flakiness reported explicitly. The result renders as a
terminal report, a markdown PR comment (via the bundled
GitHub Action), and machine-readable JSON. Temporary worktrees live outside the working tree; the
optional cache is stored under the Git common directory.

## Quick start

Install diff0 in your agent repository:

```sh
pnpm add -D @knowbody/diff0
```

Then compare your current branch with `main`:

```sh
pnpm exec diff0 run --base main --head HEAD

# preview the cost before committing to a full comparison:
pnpm exec diff0 estimate --base main --head HEAD --runs 3
```

To work on diff0 itself, install from a source checkout:

```sh
git clone https://github.com/knowbody/diff0
cd diff0
pnpm install --frozen-lockfile && pnpm build

# from your agent repo (a git repo with an eve app + an evals/ suite):
node /path/to/diff0/dist/cli.js run --base main --head HEAD
```

Requirements:

- **Node >= 20** for the diff0 CLI itself.
- **Linux or macOS.** Windows is not supported because diff0 relies on POSIX process-group
  termination to stop an eval and all of its descendants safely.
- The **target repo** needs whatever eve needs: **Node >= 24**, `eve` installed as a dependency,
  and an `evals/` suite (`evals/**/*.eval.ts` + `evals/evals.config.ts`). If it has none, diff0
  exits 2 with a copy-pasteable minimal suite.
- **git** — refs are checked out with `git worktree`.
- The target repo's package manager. Node package managers are detected from the lockfile; install
  Bun on the runner before diff0 when the target uses `bun.lock` or `bun.lockb`.
- Model credentials in your environment as usual (`AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY`, …).
  diff0 never logs or persists key values, but code in either compared ref executes with the eval
  process environment. Read the trust-boundary section below before using credentials in CI.

## GitHub Action

The bundled composite action posts one sticky PR comment (edited in place on every push, never
spammed). See the
[Action guide](https://github.com/knowbody/diff0/blob/main/action/README.md) for inputs, outputs,
the trust boundary, and how the check outcome is decided.

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

The `paths` list is ordinary GitHub Actions configuration, so teams decide exactly which changes
deserve a behavioral comparison. Remove it to run diff0 on every pull request, or narrow it to the
agent, tools, prompts, evals, model configuration, and lockfiles that can change observed behavior.
Documentation-only changes can then skip the model runs entirely.

If `diff0` is configured as a required status check, do not skip the whole workflow with `paths`:
GitHub can leave a path-filtered required workflow pending. Either keep the workflow unconditional,
or require a separate always-running gate check and conditionally run the expensive diff0 job.

## Built by Eve, checked by diff0

This repository contains its own [Eve maintenance agent](https://github.com/knowbody/diff0/blob/main/agent/README.md), adapted from Vercel
Labs' official Software Factory template. A maintainer can label an issue `eve-build`; diff0 Eve
then runs classifier, analyst, implementer, and independent reviewer stations and delivers an
`eve/*` draft pull request. The factory cannot merge, and marking a pull request ready remains a
human decision.

Every same-repository pull request runs the credential-free diff0 engine dogfood check against
`fixtures/demo-agent`; fork pull requests run ordinary CI and require maintainer review before the
behavioral comparison. Agent source changes are compiled, unit tested, and inspected by ordinary
CI. Real-model comparisons remain an explicit local maintainer operation: running ref-selected
agent code with reusable model or storage credentials in GitHub Actions would expose those
credentials to the code being evaluated.

The Action supports named sticky-report keys so multiple behavioral reports can coexist on one PR.
This is the intended loop: Eve improves diff0, conventional CI checks the CLI, and diff0 checks
observable agent behavior in a credential-isolated environment.

## Configuration

`diff0 run --base <ref> [--head <ref>] [options]`:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base <ref>` | (required) | Base git ref (e.g. `main`, `origin/main`, a SHA) |
| `--head <ref>` | `HEAD` | Head git ref |
| `--repo <path>` | `.` | Target repo (must be a git repo with an eve app + evals) |
| `--app-dir <path>` | `.` | Path of the eve app *within* the repo (for monorepos) |
| `--runs <n>` | `3` | Eval-suite executions per ref |
| `--evals <filter>` | all | Eval id/prefix filter; repeatable or comma-separated |
| `--timeout <ms>` | eve default | Per-eval timeout; the adapter also enforces a finite outer suite timeout |
| `--max-concurrency <n>` | eve default | Passed to `eve eval --max-concurrency` |
| `--install-mode <mode>` | `scripts-off` | `scripts-off` disables dependency lifecycle/build scripts; `scripts-on` enables them for refs you trust |
| `--max-spend <usd>` | none | Hard cap; abort (exit 4) when cumulative measured cost would exceed it |
| `--report-md <path>` | none | Write the markdown report here |
| `--report-json <path>` | none | Write the JSON report here |
| `--json` | off | Print the JSON report to stdout instead of the terminal render |
| `--cache` | off | Opt into the 24-hour base-ref cache; external state is not part of its key |
| `--fail-on <policy>` | `regression` | `regression` \| `drift` \| `never` — what makes exit code 1 |
| `--no-color` | auto | Disable ANSI in terminal render |

The former `safe` and `trusted` install-mode names remain accepted as deprecated aliases for
`scripts-off` and `scripts-on`, respectively.

`diff0 estimate --base <ref>` takes `--head`, `--repo`, `--app-dir`, `--runs`, `--evals`, and
`--max-spend` plus `--install-mode`, and never runs more than one eval-suite pass.

Exit codes and the full behavioral contract: [docs/cli-contract.md](https://github.com/knowbody/diff0/blob/main/docs/cli-contract.md).

## How diff0 handles nondeterminism

An LLM agent doesn't produce the same run twice, so a single-run diff is noise presented as
signal. What diff0 does instead:

- **N runs per ref, compared as proportions.** Default `--runs 3`, interleaved base/head to
  reduce time-of-day provider drift. Every number in the report reads "passed 3 of 3 runs",
  never "passes".
- **Different pass proportions are tested, not relabeled as flake.** diff0 fixes the correction
  family before looking at changes: every eval with complete coverage on both refs participates,
  and equal-rate evals contribute p=1. It then uses a directional one-sided Fisher exact test at
  family-wise alpha 0.05 with Holm adjustment. A significant drop is **REGRESSED** and a
  significant increase is **IMPROVED**, even when one ref contains mixed outcomes. For example,
  5/5 → 1/5 is a regression
  and 1/5 → 5/5 is an improvement before any cross-eval adjustment; the report includes both raw
  and adjusted p-values so the final classification is auditable.
- **Obvious complete collapses also fail the release gate.** If an eval passes every base run and
  fails every head run across at least 3 complete runs per ref, the top-level verdict is red even
  when a multi-eval Holm family leaves that row statistically inconclusive. The row retains its raw
  and adjusted Fisher evidence and is not relabeled as statistically confirmed.
- **Unconfirmed rate changes are explicitly inconclusive.** A lower or higher observed pass rate
  that does not clear the adjusted threshold gets a yellow, inconclusive status rather than a
  confident regression or improvement. If both refs have the same observed pass proportion but
  either ref mixes passes and failures, the eval is labeled **FLAKY** for that ref.
- **Incomplete eval coverage is not treated as a comparable rate.** If an eval is observed in
  fewer suite runs than expected on either ref, diff0 reports `partial-base`, `partial-head`, or
  `partial-both` and keeps the verdict yellow rather than making a Fisher claim from mismatched
  coverage.
- **Soft-score changes have an explicit materiality floor.** A base/head median score drop of at
  least 0.1 is a material score regression and makes the verdict yellow. Smaller scorer-only
  movement stays within threshold; score movement never masquerades as a statistically confirmed
  pass-rate regression. Scores are aligned by check name and repeated-name occurrence, not array
  position. Changed scorer sets or incomplete per-run scorer coverage are comparison-validity
  warnings rather than silently comparable samples.
- **Behavioral confidence names the evidence actually available.** Skill and subagent proportions
  use a shared complete-hypothesis Holm family (unchanged hypotheses contribute p=1) and can be
  `statistically-confirmed`. Repeated deterministic tool/output differences can be `stable`;
  weaker evidence is `inconclusive`.
- **The two-proportion z-score is a labeled directional hint, never the verdict.** Fisher + Holm
  determines the eval classification. diff0's statistical treatment is deliberately compact; for
  a more formal treatment of behavioral regression testing for agents, see the AgentAssay paper
  (Bhardwaj, [arXiv:2603.02601](https://arxiv.org/abs/2603.02601)).
- **N=1 disables flake detection, and the report says so.** One run cannot reveal within-ref
  variance, and a lone pass/fail flip cannot clear the Fisher threshold, so it is inconclusive.
- **Borderline results at N<5 add a recommendation** to re-run with `--runs 5` or more for a
  clearer signal.
- **Comparison-validity header.** Every report states eve version, model id, sandbox backend,
  and run counts per ref; scorer-set and scorer-coverage validity is checked too. If any of these
  differ, explicit warnings are attached instead of pretending the refs are comparable. An eval
  row can still expose its Fisher-supported apparent regression, but comparison validity caps the
  overall verdict at yellow rather than red. The sandbox backend is labeled `(inferred)` because
  eve never reports which backend it picked — diff0 replicates eve's selection probe once per
  comparison.
- **Data-source transparency.** Each run records which capture sources actually fed it (eval
  JSON, spans, logs), and missing data is reported as missing — a cost that cannot be measured
  is "unavailable", never $0.
- **Public JSON does not expose correlatable fingerprints.** Tool-input and final-output evidence
  uses comparison-local `fp-N` frequency-class labels plus captured-run counts; raw content and
  deterministic hashes are not serialized. Final-output frequency arrays reveal distribution
  shifts while preserving the multiplicity of distinct, structurally equivalent fingerprints.

## Why not just evals?

The committed example report — [examples/drift-report.md](https://github.com/knowbody/diff0/blob/main/examples/drift-report.md) — is a real
end-to-end run on a real model (`anthropic/claude-haiku-4.5`, 5 runs per ref, comparison cost
$0.1188, all billed through AI Gateway). The head commit deleted two lines from
`agent/instructions.md` — the rule telling the agent to delegate a summary to the `reporter`
subagent. What each tool saw:

- The standalone `eve eval` run shown in the demo passed 4/4. Across diff0's repeated runs, two
  evals passed less often on head (5/5 → 3/5 and 5/5 → 4/5), but neither drop is
  statistically conclusive at N=5.
- diff0: the `reporter` subagent ran in 5 of 5 base runs → **0 of 5** head runs, the tool
  sequence lost its delegation step, and median session cost fell **33%** ($0.0141 → $0.0095)
  with duration down 40% — the delegation round-trips left the run.

Eval green ≠ behavior unchanged. The organic real-model counts in
[examples/flake-report.md](https://github.com/knowbody/diff0/blob/main/examples/flake-report.md) also demonstrate why proportions and the
declared comparison family both matter: 1/5 on base → 5/5 on head has raw Fisher p≈0.0238 and
would be a supported **improvement** in a one-eval family, but it remains inconclusive after Holm
adjustment across that report's four complete evals. The 4/5 → 5/5 increase is also inconclusive.

## How is this different?

Several tools live near this space; they differ by mechanism.

- **Static risk classifiers** — [agentdiff](https://github.com/agentdiff-ai/agentdiff)
  classifies the PR's source diff for risk escalation via import reachability, without
  executing the agent.
- **Snapshot baseline testing** — [agentprdiff](https://pypi.org/project/agentprdiff/) records
  a behavior baseline file, commits it, and compares future runs against it.
- **Portable trace diffing and contracts** —
  [whatbroke](https://github.com/arthi-arumugam-git/whatbroke) compares tool calls, arguments,
  outputs, cost, and latency; it supports multi-sample flake rates, behavior contracts, trace
  importers, proxy/SDK capture, and a GitHub Action.
- **Snapshot regression testing** — [EvalView](https://github.com/hidai25/eval-view) records
  multi-variant behavior baselines, compares tool parameters and outputs, supports statistical
  runs and several agent stacks, and can act as a CI gate.
- **Statistical testing research** — the
  [AgentAssay paper](https://arxiv.org/abs/2603.02601) gives a formal fingerprint-vector and
  sequential-testing treatment of behavioral regression.
- **Hosted eval platforms** —
  [LangSmith](https://docs.langchain.com/langsmith/analyze-an-experiment) and similar products
  provide repeated experiments, baselines, output/score comparison, traces, tokens, cost, and
  latency in a dashboard.

diff0 is eve-native and zero-instrumentation (it wraps `eve eval` and reads eve's own output),
git-ref-vs-ref so there are no baseline files to maintain, and runs N interleaved passes per
ref with explicit statistical evidence and uncertainty — delivered as a CLI and one sticky PR
comment.

## Cost controls

Running an eval suite 2×N times costs real money on real models. The levers:

- **`diff0 estimate`** — measures one suite pass (or reuses an existing fresh base-cache entry) and
  projects the full comparison's cost and duration before you spend. Verified live against a
  gateway-billed model: `cost per run: $0.0016 (gateway)` on `openai/gpt-5-nano`. With
  `--max-spend` it exits 4 when the projection exceeds the cap, so CI can gate *before* spending.
- **`--runs`** — the biggest multiplier. 3 is the default; 5+ gives clearer signal at
  proportional cost.
- **`--evals <filter>`** — run the subset that matters for the change.
- **`--max-spend <usd>`** — hard cap during `run`: cumulative *measured* cost is checked after
  every suite run; crossing the cap aborts remaining runs and exits 4. When cost is unmeasurable
  (mock or unpriced models) the cap never triggers — it cannot invent numbers to enforce against.
- **Opt-in base-ref cache** — `diff0 run` reads and writes cached base results only with `--cache`.
  Entries live under the resolved Git common directory (normally `.git/diff0-cache/`), not in the
  working tree. The versioned key includes the commit, diff0/Eve
  versions, model, eval filter, timeout, concurrency, install mode, and inferred sandbox.
  Entries expire after 24 hours; malformed or incompatible entries are safe misses. Repeated pushes
  can re-run only the head ref. Cached reports carry a stale/external-state caveat; omit `--cache`
  for a fresh release gate.
- **`prices.json`** — bundled per-token USD prices (generated from the public AI Gateway model
  list) used as fallback when eve reports no gateway cost. User-editable; refresh with
  `pnpm run refresh-prices`.
- **Cost-source labeling** — every cost figure is labeled `gateway` (eve-reported),
  `priced-tokens` (tokens × `prices.json`), or `unavailable`. Unavailable is never rendered
  as $0. Run/model identity is assembled from distinct usage-bearing `step.started.modelId`
  values. If usage spans multiple models, step attribution is incomplete, or delegated usage has
  no model identity, the internal `pricingModel` is null and diff0 refuses to guess a token price.

## Credential-free CI mode

diff0's demo agent ([fixtures/demo-agent](https://github.com/knowbody/diff0/tree/main/fixtures/demo-agent)) — and therefore diff0's own test
suite and dogfood workflow — runs with **zero credentials and zero model spend** when no API key
is present. This is not a stub of the pipeline: every run uses the real eve runtime — a real dev
server, real tool calls (`run_sql`), real skill loading (`revenue-definitions`), real subagent
delegation (`reporter`). Only the LLM is scripted: eve's own deterministic `mockModel()`, made
context-sensitive to the system prompt so that editing `agent/instructions.md` produces genuine,
measurable behavior drift. That is what lets CI (and you) exercise the entire
worktree → install → eval → report pipeline deterministically, without secrets in any workflow —
diff0's own CI and its dogfood PR run exactly this way.

The moment a gateway credential is present, the same fixture switches to a real model by default.
Selection is controlled by one env var:

| `DIFF0_DEMO_MODEL` | Behavior |
| :-- | :-- |
| unset (auto) | Real `anthropic/claude-haiku-4.5` when `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is set; otherwise the deterministic mock (credential-free CI mode). |
| `mock` | Always the deterministic mock, even when credentials are present. diff0's own integration tests pin this so they never spend. |
| any other non-empty value | Used verbatim as an AI Gateway model id (e.g. `anthropic/claude-sonnet-4.5`). Requires gateway credentials at run time. |

Honesty note: reports label the model from older Eve's `runtimeIdentity.modelId` or fall back to
the ref's own `eve info --json` on current Eve.
A mock run shows `` model `eve-mock/mock-revenue-analyst` `` in the report header — a
credential-free run never masquerades as a real-model result.

## CI trust boundary

diff0 is an execution harness, not a sandbox. It installs dependencies and runs evals, tools,
subagents, and arbitrary application code from **both refs**. Installs require exactly one lockfile
and use frozen/immutable package-manager modes. The default `--install-mode scripts-off` disables
lifecycle/build scripts; `--install-mode scripts-on` executes repository-controlled install scripts
from both compared refs and must only be used for refs you trust. Both modes scrub
credential-shaped install environment variables and isolate `HOME`. Registry credentials/config
remain available so private packages can resolve; in `scripts-on` mode, repository-controlled install
scripts can therefore access package-registry authentication. Once eval execution begins, a malicious or
compromised ref can read every credential intentionally exposed to that eval job.

- Use it automatically only for code you trust, or run it in a disposable, network-restricted,
  secret-free environment.
- Do not put long-lived provider, cloud, package-registry, or GitHub credentials into an
  untrusted PR job. Prefer deterministic mocks for automatic PR checks and a protected/manual job
  for real-model comparisons.
- The Action refuses fork PRs and `pull_request_target` by default. `allow-untrusted-head: true`
  is an explicit escape hatch for an isolated secret-free runner; it does not make the code safe.
- Never switch to `pull_request_target` merely to obtain secrets or a write token. That combines
  privileged credentials with execution of head-controlled code.
- The Action exports its `github-token` input only to the comment step, but `actions/checkout`
  persists the job token in Git config by default. Set `persist-credentials: false` as shown above;
  the Action refuses to run when it detects checkout's persisted HTTP auth header. Ordinary fork
  PR tokens cannot write comments, so fork comments are skipped.

## Known limitations & versioning

- **The adapter is tested against the older Eve `0.29.5` summary contract and current Eve
  `0.47.5`.** The development dependency and deterministic fixture use `0.47.5`; captured fixtures
  retain coverage for the older result shape. Eve is fast-moving, so invocation and output parsing is
  isolated in one churn-absorbing adapter
  ([src/adapters/eve.ts](https://github.com/knowbody/diff0/blob/main/src/adapters/eve.ts)) — nothing else touches eve. Also validated
  end-to-end against [vercel-labs/steve](https://github.com/vercel-labs/steve), Vercel's own
  self-hosted example agent, which pins eve `0.25.2`: full two-ref comparison, 3 evals × 2 runs
  per ref, all green, gateway cost captured (requires steve's Postgres via docker compose,
  `pnpm run db:migrate`, and a one-line model patch to a gateway id when only
  `AI_GATEWAY_API_KEY` is available).
- **No per-invocation model override exists upstream** (vercel/eve#577), so a "compare on a
  cheaper model" flag is not shippable in v1.
- **Cost for direct-provider models** (e.g. authored `anthropic(...)` SDK objects) comes from
  `prices.json` or is `unavailable` — eve only reports cost for AI Gateway-served models.
- **The sandbox backend is inferred, not observed.** eve selects docker/microsandbox/just-bash
  without exposing that selection in eval output;
  diff0 replicates the probe once per comparison and labels the result `(inferred)`.
- **`NODE_ENV=test` is dropped from the eval environment** because eve swaps authored models for
  mocks under it, which would invalidate the comparison.
- **Flakiness is undetectable at `--runs 1`** — a single run cannot reveal within-ref variance;
  the report says so instead of guessing.
- **Free-tier AI Gateway keys rate-limit agentic eval suites** — full real-model comparisons
  need a paid gateway account (any top-up lifts the tier).
- **The eval process has an outer safety bound.** Without `--timeout`, a suite is stopped after 30
  minutes. With it, the outer bound is `per-eval timeout × selected eval count + 2 minutes`, capped
  at 12 hours. Combined stdout/stderr is capped at 16 MiB so a runaway child cannot exhaust memory.

## Roadmap

1. `diff0 accept` — bless an intentional behavior change so known drift stops flagging.
2. Sequential early stopping (SPRT) — stop running evals once the verdict is statistically settled (inspired by the AgentAssay paper; implemented from primary statistics literature only).
3. Fingerprint-vector drift detection — compact behavioral vectors for higher detection power at low N (same sourcing rule).
4. Trace enrichment — re-enable eve's OTel traces as a data source once span topology stabilizes upstream.
5. Historical trend tracking across merged PRs.

## More

- [examples/](https://github.com/knowbody/diff0/tree/main/examples) — committed reports from end-to-end runs
- [agent/](https://github.com/knowbody/diff0/tree/main/agent) — the repository's Eve maintenance agent
- [docs/cli-contract.md](https://github.com/knowbody/diff0/blob/main/docs/cli-contract.md) — the stable CLI and Action contract
- [LICENSE](https://github.com/knowbody/diff0/blob/main/LICENSE) — MIT
