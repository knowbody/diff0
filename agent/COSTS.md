# Model selection and planning estimates

Selected on 2026-09-05 using the public [AI Gateway catalog](https://ai-gateway.vercel.sh/v1/models).
All prices below are USD per million tokens at the listed standard global rate. Provider routing,
regional rates, context tiers, cache behavior, and future price changes can change the bill.

| Responsibility | Model | Input | Output | Cached input read |
| --- | --- | ---: | ---: | ---: |
| Classification, orchestration | GPT-5.6 Luna | 0.20 | 1.20 | 0.02 |
| Analysis, research | GPT-5.4 Mini | 0.75 | 4.50 | 0.075 |
| Implementation | Claude Sonnet 5 | 2.00 | 10.00 | 0.20 |
| Independent review | GPT-5.6 Terra | 2.00 | 12.00 | 0.20 |

Luna handles structured routing and coordination. Mini handles bounded investigation.
Sonnet handles repository edits and tools. Terra retains a stronger independent review gate from
a different provider family. One small connected task has now completed; see
[`SMALL-TASK-RUN.md`](SMALL-TASK-RUN.md) for measured costs and validation gaps.
No automatic upgrade to a more expensive model is configured. These assignments live only in
`agent/lib/models.ts` and are not live in production until deployment.

## Estimates

Allow $1–2 in model usage for a small, well-specified fix and $3–5 for a medium task including review.
These are planning allowances, not hard limits or promises of completion. A small-task example
using 150k fresh input, 500k cached input, and 15k output tokens at Sonnet rates costs $0.55 before
planning/review. A medium example using 500k fresh input, 2m cached input, and 40k output costs
$1.80 before planning/review. Cache creation is separate: Sonnet's listed write rate is $2.50/M.
Long investigations, retries, large context, or poor cache reuse can exceed these allowances.

Repricing the failed first attempt's recorded step tokens with the initial economical mix
(Mini orchestration, before the Luna trial below) gives:

| Completed usage through failure | Hypothetical cost |
| --- | ---: |
| Orchestration | $0.0311 |
| Classification | $0.0004 |
| Analysis | $0.3489 |
| Implementation | $2.4614 |
| Total | $2.8417 |

This is arithmetic over the existing trace, not a paid replay, measured savings, or a completed
task estimate. It holds token counts and cache categories constant; new models can behave
differently. The trace recorded $12.17 under the previous configuration. Review never ran.
For each step, the estimate prices fresh input as total input minus cache reads and writes,
prices each cache category separately, and adds output. Where a model has no separate cache-write
rate, writes use the input rate. It excludes external tools, hosting, and other CI/eval runs.

The CI thresholds ($3 maintenance agent, $0.30 demo) remain measured-cost stop thresholds,
not guaranteed caps. Production tasks still lack a per-task dollar budget. Lower model prices do not
solve runaway behavior: keep paid retries paused until an explicit budget and progress-stop
policy are agreed and enforced. The controlled small-task run used a dedicated $3 Gateway key
and delivered a draft PR for $0.79705881 in model charges, excluding infrastructure. This is
one narrow sample, not a replacement for the planning allowances above.

## Luna orchestration trial

On 2026-09-05, one pass of the four connector-free evals passed using Luna for both root
orchestration and classification: `smoke`, `routing/needs-clarification`,
`safety/prompt-injection`, and `safety/write-requires-approval`. Execution took approximately
38 seconds. The dedicated Gateway key reported $0.01063793 of spend and $0 of BYOK spend.
It had an active $1 budget, no automatic refresh, and included BYOK in the quota. The test
used local just-bash, not hosted Vercel sandboxes. The key was created only for this trial.

This validates a single routing/safety pass, not the full coding pipeline or statistical
reliability. Source validation also passed 72 tests with zero discovery diagnostics.
The raw local evidence is `.eve/luna-trial.json`; key quota metadata is in
`.eve/luna-key-metadata.json`. No secret key value belongs in this document or Git.

For future controlled trials, use a dedicated [Gateway key budget](https://vercel.com/changelog/budgets-for-api-keys-on-ai-gateway)
shared by every station, with refresh disabled. Gateway rejects further requests after its
budget is exceeded; an in-flight request may overshoot. This is separate from hosting charges
and is stronger than the comparison report's incomplete cost attribution. Do not silently
fall back to an unbudgeted key or project OIDC credential.

## Fully verified follow-up

The same small formatting assignment subsequently completed with all required checks running
inside the independent reviewer's offline sandbox for **$0.44270089** in model calls. The local
round total was **$0.75807281**, including setup failures and interrupted durable sessions that
resumed before explicit cancellation. Infrastructure is additional. See `SMALL-TASK-RUN.md`.

Stopping a local eval client does not cancel its durable Eve turn. Before restarting a stopped
trial, cancel its active session through `POST /eve/v1/session/<id>/cancel` and confirm
`turn.cancelled` followed by `session.waiting`. Keep all attempts on the same budgeted key so
resumed work cannot silently acquire a fresh spending allowance.
