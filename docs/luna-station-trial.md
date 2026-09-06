# Luna station trial — September 6, 2026

The trial assigns Luna xhigh to the analyst, implementer, and researcher. The root
and classifier retain Luna with provider-default reasoning, the reviewer remains
Terra, and the eval judge remains Gemini Flash. Standard processing is used.

## What we measured

Seven controlled runs used the real AI Gateway and the actual authored station
instructions and output schemas. The harness uses AI SDK directly with local,
in-memory tool substitutes. It does not run the full Eve pipeline.

The analyst plans a small README change. The implementer adds a Reporting bugs
section, preserves existing text, runs deterministic content checks, and must
honestly report that publication is unavailable. The researcher compares prices
using two supplied official documentation snapshots and must cite fetched sources.
There are no GitHub writes, shell commands, or hosted sandboxes in this pilot.

| Role | Previous model | Previous cost / time | Luna xhigh cost / time | Observed result |
| --- | --- | --- | --- | --- |
| Analyst | GPT-5.4 Mini | $0.003592 / 5.9s | $0.002470 / 31.5s | Both passed the basic plan checks; Luna was cheaper but slower |
| Implementer | Sonnet 5 | $0.031260 / 17.7s | $0.001077 / 10.3s | Both passed the README edit and publication-honesty checks |
| Researcher | GPT-5.4 Mini | $0.006033 / 7.4s | $0.006681 / 56.7s, including retry | First Luna result was invalid structured output; follow-up passed |

The initial six runs used a 2,048-output-token allowance and at most six model
steps per run. The researcher follow-up increased the allowance to 4,096 tokens;
it passed. Because generation varies, this does not isolate the token limit as
the cause of the first failure. That failure remains in the measurement record.
No production output-token limit was changed by this experiment.

Total gateway-reported model cost was **$0.0511122**, excluding a tiny 19-token
connectivity probe. These are observed charges including the cache behavior of
these requests, not a forecast for the factory. The first connectivity attempt
hit the key-specific $10 budget; after the owner increased it to $15, the probe
and pilot could run. The account balance and per-key limit are separate controls.

The [measurement record](luna-station-trial.json) includes both attempts, token
usage where available, tool-call counts, checks, and timings. Basic plan/schema
checks do not establish planning quality. A documentation edit does not establish
coding ability, and supplied snapshots do not establish live research quality.
Reviewer quality, retries on real code, publication, sandbox costs, and full
pipeline behavior remain unmeasured. This is one task per role, not a benchmark.

## Repeat locally

Install the repository dependencies and export `AI_GATEWAY_API_KEY` through your
normal secret mechanism. From the repository root:

```sh
pnpm agent:trial:models
pnpm agent:trial:models --role researcher --variant candidate \
  --max-output-tokens 4096 --report-dir .eve/luna-trial-researcher-followup
```

The default report is `.eve/luna-trial/results.json`. This is a paid command.
Each invocation stops before starting another model step once measured spend
reaches $0.75, reserving headroom toward a $1 target, and stops further calls if
cost becomes unknown. Checks occur between atomic requests; the provider's own
key limit remains the final spending control. The command exits nonzero for
failed trial checks. Historical baseline models are frozen in the pilot script;
candidates come from the current authored station configs.

Keep the trial unmerged until representative scratch-repository pipeline runs
verify actual implementation quality, reviewer findings, retries, and total
cost. The researcher result gives no reason to assume xhigh is the cheapest or
fastest choice for every role.
