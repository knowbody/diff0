# Luna implementation trial

Keep Mini for analysis and research, Luna for orchestration/classification, and Terra for review. Trial Luna xhigh for implementation only. The [earlier station pilot](luna-station-trial.md) did not justify moving analysis or research: both were slower on Luna, and research needed a larger output allowance after a structured-output failure. Gemini Flash remains the eval judge.

## Executable coding comparison

Six real Vercel AI Gateway runs compared Sonnet 5 (provider-default reasoning) with Luna xhigh on three small dependency-free JavaScript tasks. Each implementation received a fresh Terra review. All six passed immutable acceptance assertions, received approval, and completed local review attestation on the tested commit, on their first attempt. No revisions were needed.

Costs include implementation and review; elapsed times include local checks and review. These are measured gateway costs, not projected list-price estimates.

| Task | Sonnet cost | Luna cost | Sonnet elapsed | Luna elapsed |
| --- | ---: | ---: | ---: | ---: |
| TTL expiration boundary bug | $0.061492 | $0.010365 | 32.2s | 19.2s |
| Add immutable chunk function | $0.054066 | $0.011484 | 25.4s | 21.1s |
| Refactor status summary to one pass | $0.045357 | $0.010855 | 23.0s | 22.6s |
| Total | $0.160915 | $0.032704 | 80.5s | 62.9s |

The completed comparison cost **$0.19361881**. Luna's implementation-plus-review cost was about **80% lower** in this sample. Implementation alone cost $0.00352021 for Luna versus $0.127838 for Sonnet. Cache accounting differed: Luna implementation calls received cached input, while Sonnet calls did not. Task order alternated, but each task/model pair ran only once; these figures do not establish a general cost ratio or latency guarantee.

The [recorded results](luna-coding-trial.json) include every completed comparison attempt, token/cache usage, code diffs, checks, review findings, and costs. The bug and feature fixtures fail before implementation; the refactor fixture passes before and after, with the actual single-pass change checked in review. All implementation reports correctly say `pushed: false`.

An initial diagnostic run exposed an incomplete harness review protocol: it omitted the review-attestation tool and the completed-check flag. Terra correctly withheld approval despite passing code. That run was stopped and excluded from model-quality comparisons, then the protocol was fixed and the full comparison restarted. The diagnostic recorded an additional $0.18995184; an interrupted in-flight request may have incurred further cost. This is a harness setup failure, not a model failure. The earlier station pilot's spending is also separate.

## Reproduce locally

```sh
pnpm install --frozen-lockfile --ignore-scripts
# Supply AI_GATEWAY_API_KEY through your environment; do not commit it.
pnpm agent:trial:coding
```

Use a Node version with filesystem and network permission controls (tested on Node 26.7.0). Results are written to `.eve/coding-trial/results.json`, replacing the previous result file. Save prior results before rerunning. Scratch Git repositories remain in the OS temporary directory for inspection.

The harness uses the actual authored implementer/reviewer prompts and output schemas through the AI SDK, with local tools replacing production services. Generated code runs in a separate Node process without the gateway credential; permissions deny network access, writes, child processes, and reads outside its scratch directory. A preflight verifies these restrictions. Only `index.mjs` can be edited; the assertion body remains in the parent driver. Tests must reach the completion marker, and review attestation requires successful checks on the unchanged local commit.

There are at most two attempts per task/model, eight steps per stage, 4,096 output tokens per step, no SDK retries, and a two-minute stage timeout. The $2 spend target uses measured checks between requests, stopping future requests at $1.50 to reserve $0.50; it is not a hard billing cap. Unknown cost stops subsequent requests. Keep a provider-side key limit as the billing cap.

## What this establishes

Luna completed these three small coding tasks with executable evidence and independent review, cheaply enough to continue the implementation trial. Keep the PR experimental and unmerged until representative repository work establishes quality and total workflow cost.

This is not a full Eve pipeline run: it does not validate GitHub/Connect/Sandbox integration, production publication, remote attestation, automatic model fallback, or larger multi-file work. Those credentials were not configured. Local attestation is only a trial record and never authorizes publication. The same-provider Luna/Terra pairing retains separate review context but relaxes provider diversity as explicitly approved for this trial.
