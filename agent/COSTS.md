# Model selection and planning estimates

Selected on 2026-09-05 using the public [AI Gateway catalog](https://ai-gateway.vercel.sh/v1/models).
All prices below are USD per million tokens at the listed standard global rate. Provider routing,
regional rates, context tiers, cache behavior, and future price changes can change the bill.

| Responsibility | Model | Input | Output | Cached input read |
| --- | --- | ---: | ---: | ---: |
| Classification | GPT-5.6 Luna | 0.20 | 1.20 | 0.02 |
| Orchestration, analysis, research | GPT-5.4 Mini | 0.75 | 4.50 | 0.075 |
| Implementation | Claude Sonnet 5 | 2.00 | 10.00 | 0.20 |
| Independent review | GPT-5.6 Terra | 2.00 | 12.00 | 0.20 |

Luna handles narrow structured routing. Mini handles coordination and bounded investigation.
Sonnet handles repository edits and tools. Terra retains a stronger independent review gate from
a different provider family. This is an initial cost/quality choice, not a completed quality eval.
No automatic upgrade to a more expensive model is configured. These assignments live only in
`agent/lib/models.ts` and are not live in production until deployment.

## Estimates

Allow $1–2 in model usage for a small, well-specified fix and $3–5 for a medium task including review.
These are planning allowances, not hard limits or promises of completion. A small-task example
using 150k fresh input, 500k cached input, and 15k output tokens at Sonnet rates costs $0.55 before
planning/review. A medium example using 500k fresh input, 2m cached input, and 40k output costs
$1.80 before planning/review. Cache creation is separate: Sonnet's listed write rate is $2.50/M.
Long investigations, retries, large context, or poor cache reuse can exceed these allowances.

Repricing the failed first attempt's recorded step tokens with the selected models gives:

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
not guaranteed caps. The full task still lacks a hard dollar budget. Lower model prices do not
solve runaway behavior: keep paid retries paused until an explicit budget and progress-stop
policy are agreed and enforced. No paid eval was run to validate this model selection.
