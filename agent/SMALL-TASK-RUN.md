# Budgeted small-task dogfood run

On 2026-09-05, Eve completed `pipeline/tiny-cost` against the private disposable repository
`knowbody/diff0-eve-sandbox`. It changed tiny positive costs from `$0.0000` to `<$0.0001`,
added five boundary tests, rebuilt the Action bundle, and opened
[draft PR #2](https://github.com/knowbody/diff0-eve-sandbox/pull/2).

The root session was `wrun_01M1SGA98Q6S49A1CSYNMGV9CC`; the trace is
`6d55f3a7ce515512ad808814752ffb1c`. The eval ran from 19:21:52 to 19:34:17 UTC
(approximately 12m25s). Its assertions passed for successful completion, completed calls to
all four stations, station order, and a draft `github__createPullRequest` call. GitHub confirms
the PR is a draft, with head `79e2977181142239656d06efee9de9a64af3fc32`.

## Measured model costs

| Station | Model | USD |
| --- | --- | ---: |
| Orchestration | GPT-5.6 Luna | 0.01395996 |
| Classification | GPT-5.6 Luna | 0.00084830 |
| Analysis | GPT-5.4 Mini | 0.09210465 |
| Implementation | Claude Sonnet 5 | 0.45566140 |
| Independent review | GPT-5.6 Terra | 0.23448450 |
| Total | | 0.79705881 |

The sum of recorded step costs matches the dedicated Gateway key's reported spend.
The key had an active $3 budget, included BYOK, and did not refresh automatically. It was
revoked after completion; no extra credit was purchased. These figures exclude hosted
sandbox/template and other infrastructure charges. This is one narrow task, not a general
promise that full coding tasks cost less than $1.

## Validation and limitations

The station reviewer returned `approve` and attested the published commit. Its report records
passing typecheck, lint, 364 unit tests, build, and Action bundle consistency. It explicitly
leaves integration tests and the deterministic demo comparison unchecked: isolated install
homes could not access the cached package manager/dependencies in the offline sandbox.
No behavioral verdict was produced inside the factory. Do not interpret the pipeline eval's
pass as proof that every required repository check ran successfully there.

Analysis failed twice (an empty model response, then invalid structured output) and completed
on the third attempt. The root exceeded the written one-retry rule; this remains a reliability
gap. The implementer also spent time diagnosing isolated-home cache behavior. Future bootstrap
work should make those checks executable offline and enforce retry limits in runtime code.

The supervising agent independently checked out the published commit outside the factory and
verified the five new tests, Action bundle consistency, and all six integration tests. The
deterministic demo comparison against the scratch repository's `main` was green over three
runs per ref (all 18 eval executions passed). It used the mock model, adding no model charges.
Such outside checks supplement the draft PR; they do not retroactively turn missing station
evidence into an autonomous pass.

Local raw evidence: `.eve/small-task-run.json`, `.eve/small-task-trace.json`,
`.eve/small-task-cost-summary.json`, and `.eve/small-task-key-metadata.json`.
No production deployment, ready-for-review transition, or merge was performed.

## Runtime enforcement and offline validation follow-up

The follow-up gives pnpm and Corepack stable cache locations outside HOME. The trusted bootstrap
warms both the repository and demo dependency graphs, disables general network access, and proves
that a fresh isolated home can install the demo graph with `--offline`. It resets only its disposable
template checkout when replayed after a failed bootstrap. Live checkouts are unaffected by that reset.

A durable root hook counts consecutive failed station results by turn and call ID. A successful
station result resets its counter, so reviewer-requested revisions remain possible. A second failure
terminates orchestration before a third station delegation. The mocked Eve runtime regression
(`pnpm agent:test:runtime`) deliberately asks for endless retries and verifies exactly two failed
calls followed by a retry-exhaustion failure. Eve may replay settlement internally; it does not
launch a third child in this proof.

The reviewer attestation tool now runs the required checks directly and records which commands
passed. It refuses attestation on a nonzero exit or timeout, and rechecks checkout cleanliness and
SHA after verification. Engine/Action changes also require Action bundle consistency and a green
three-runs-per-ref deterministic mock comparison. Yellow comparisons fail this automated gate
until investigated separately. A model's assurance that a check passed is insufficient.

Setup attempts initially exposed a Corepack working-directory error and replay of partially
provisioned templates. Their model charges remain included in the same $3 non-refreshing Gateway
key budget as the eventual connected trial. Unused template compute was explicitly stopped.

When restarting local evals, cancelling the CLI transport does not cancel a durable Eve turn.
Two interrupted attempts resumed after the host restarted; they were explicitly cancelled through
`POST /eve/v1/session/<id>/cancel`, confirmed with `turn.cancelled` and `session.waiting`, and their
active coding sandboxes were stopped. Those charges are included in the round total. Future local
trial cleanup must use the cancellation endpoint before stopping its host.

The follow-up completed at 2026-09-05 20:26:56 UTC (23m19s including template preparation) and
opened [sandbox draft PR #3](https://github.com/knowbody/diff0-eve-sandbox/pull/3). Its independent
reviewer attested `1bab42967f752ecad25bcd086fec8b5c23cfdb69` after all seven authored checks passed,
including offline integration tests, bundle consistency, and a green three-runs-per-ref mock
comparison. No supervising-agent test results were supplied to obtain that attestation.

| Station | Follow-up model cost (USD) |
| --- | ---: |
| Orchestrator | 0.00888066 |
| Classifier | 0.00022128 |
| Analyst | 0.09376785 |
| Implementer | 0.19652040 |
| Reviewer | 0.14331070 |
| Completed task | 0.44270089 |

Analysis needed one schema retry, within the enforced limit. The entire local round, including
failed setup and resumed-then-cancelled attempts, used $0.75807281 according to the Gateway key.
Infrastructure charges remain separate. These are observations for one narrow assignment, not a
promise that every task will cost under $1. The same $3 non-refreshing key retained $2.24192719 for
the separately authorized deployment/intake verification.

Local evidence: `.eve/verified-trial-run.json`, `.eve/verified-trial-trace.json`,
`.eve/verified-task-cost-summary.json`, `.eve/verified-trial-key-metadata.json`, and
`.eve/station-retry-proof.json`. Local repository verification passed 376 unit tests, six integration
tests, 81 agent tests, typecheck, lint, build, and zero Eve discovery diagnostics.

## Production intake verification

The initial hosted build failed on an eagerly constructed local eval backend. It was rolled
back, the backend construction was made conditional, and a regression test was added. The
replacement was staged without moving the public alias, health-checked, then promoted.
Online Eve documentation confirmed `/eve/v1/github` as the Connect trigger destination;
the connector was corrected from `/triggers/github`, and a real webhook returned HTTP 200.

The first production attempt on [issue #20](https://github.com/knowbody/diff0/issues/20)
classified, analyzed, implemented, and independently reviewed the three-file formatting change.
The reviewer ran 366 unit tests, six integration tests, bundle consistency, and a green mock
comparison. However, the subsequent app-controlled attestation ran all seven checks in one
tool call and exceeded Vercel Hobby's 300-second function limit. No attestation or draft PR
was produced. Root and reviewer turns were explicitly cancelled and confirmed through their
streams; the intake label was removed and their sandbox compute stopped.

The gate now advances through one app-owned check per `check_review` call, using Eve's durable
per-session state. Passing results bind to the branch, head SHA, base SHA, and exact prescribed
commands. A changed commit resets progress. Each command has a 240-second deadline with a
five-second kill grace; `attest_review` refuses incomplete or stale evidence. The reviewer
prompt uses this gate for standard checks instead of duplicating them manually.

References checked online: [GitHub channel](https://eve.dev/docs/channels/github),
[Eve deployment](https://eve.dev/docs/guides/deployment/vercel),
[durable state](https://eve.dev/docs/concepts/state), and
[Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
Online docs were compared against the pinned Eve 0.47.5 package; newer stream and background
task semantics were not assumed to apply to this deployment.
