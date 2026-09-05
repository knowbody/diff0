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
