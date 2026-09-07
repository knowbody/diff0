# Calibrating diff0's warnings

A useful behavioral comparison must both catch meaningful changes and avoid
turning ordinary model variation into a review request. PR #23 exposed the latter
problem: all 24 eval observations passed, every behavioral signal was
inconclusive, but the report still asked for review.

## What affects the gate

Version 0.1.4 separates observations from findings:

- Statistically supported skill/subagent changes and repeated stable changes in
  tool paths, counts, inputs, or outputs remain behavioral findings.
- Inconclusive behavioral observations remain in Markdown details, terminal
  output, and JSON, but alone do not make a verdict yellow or violate
  `--fail-on drift` / `--fail-on behavioral-drift`.
- Eval regressions, partial or flaky eval coverage, material score regressions,
  performance-budget breaches, and validity problems retain their existing gates.
- Unknown final-output capture on a side that should be comparable remains a
  yellow coverage warning and a `comparison-validity` finding. An explicit
  `finalMessage: null` with no output is a known absence, not an artifact failure;
  parked questions may legitimately have no final response.
  A stable repeated transition from a captured response to known absence still
  counts as a behavioral finding.

A fingerprint establishes exact identity, not semantic correctness. A repeated,
fully captured change remains reviewable; free-form wording that varies within
both refs is informational. Use an eval assertion for a required answer, tool,
or approval. Green means no supported regression/review finding was detected,
not that the agents are proven equivalent. Incomplete output capture does not
invalidate otherwise complete eval pass/fail evidence or suppress a red eval gate.

The public JSON report uses schema 5 and retains optional `baseAbsentRuns` and
`headAbsentRuns` counts on final-output observations. Internal `RunRecord`
evals can carry `finalOutputAbsent: true`. Cache schema 7 invalidates older
records that cannot distinguish known absence from unknown capture.

## Automated controls

`pnpm test` covers synthetic variable-output controls at 3, 5, and 10 runs per
ref, and verifies that actual eval regressions, stable tool changes, performance
breaches, and incomplete evidence still gate. These are known-outcome contract
checks, not measurements of real-model error rates.

`pnpm test:integration` also executes `fixtures/calibration-agent` through real
Eve servers and isolated Git worktrees. Its scripted model deliberately varies
request IDs while preserving the answer and required tool call. The same-ref
comparison must remain green with inconclusive observations preserved. A second
committed ref skips the required lookup and returns the wrong answer; both evals
must regress and produce red. No model credentials are needed for these tests.

## Live-model measurements

### First measurement: maintenance agent, September 6, 2026

We compared `c69f6b1` with itself using the same four evals as PR #23 through
the real AI Gateway, with Eve 0.47.5 and root model `openai/gpt-5.6-luna`. All 40 eval
observations in the first five runs per side passed.

| Runs per side | Previous engine | This change |
| --- | --- | --- |
| 3 | Yellow | Yellow: a repeated tool-count difference |
| 5 | Yellow | Green: only inconclusive observations |
| 10 | Not obtained | Not obtained |

At three runs, `ask_question` appeared once in every base run of the clarification
eval and never on head. The existing stable-count heuristic still warns about
that pattern. By five runs, it was variable and inconclusive. This is a remaining
source of same-commit warnings; this change does **not** eliminate false alerts.
Calibrating that heuristic is separate from removing inconclusive-only warnings.

The gateway key exhausted its existing $10 total budget during head run six.
Later API-budget failures were excluded and collection was stopped. The key limit
is not this experiment's cost: attributable cost was unavailable, so diff0's
measured-cost cap could not protect it. We did not raise the gateway budget.

The [measurement record](calibration/2026-09-06-maintenance-aa.json) records the
interruption, method, and both engines' results; the [five-run report](calibration/2026-09-06-maintenance-aa.md)
retains the observations. Results were recomputed from saved Eve artifacts after
interruption. The two sample sizes overlap, and one interrupted experiment is
insufficient to estimate false-alert rates or choose a new default.

### Repeating the measurement

From a source checkout with dependencies installed, export the target agent's
normal credentials and run:

```sh
pnpm calibrate --repo /path/to/agent-repo --base <commit> --head <same-commit> \
  --evals smoke --runs 10 --sample-sizes 3,5,10 --max-spend 1 \
  --report-dir /tmp/diff0-calibration
```

Replace the paths, commits, eval IDs, and spend cap for your app. Both refs must
contain the same evals and local runtime setup. A real calibration calls models
and tools just like `diff0 run`; it is not a credential-free test. Cost that
cannot be attributed remains unavailable and cannot be capped reliably.

The contributor script collects a fixed pool of 10 fresh runs per side in
counterbalanced order, then analyzes disjoint blocks of 3, 5, and 10 within that
pool. Sizes reuse observations and are **not independent experiments**. It does
not keep rerunning until it sees significance. A sample is too small to establish
a general false-alert rate or select a universal default.

The output directory contains `full.md`, privacy-preserving `full.json`, and
`summary.json` with each block's verdict, gate categories, pass counts, and
attributable cost. Raw fingerprints remain in memory. For a before/after engine
comparison on exactly the same observations, optionally supply
`--reference-module /path/to/previous-checkout/dist/index.js`; build that checkout
first. It must export `computeDelta` and should be trusted local code.

Repeat with a known bad committed agent change and an unchanged eval suite to
measure detection alongside warning frequency. Useful changes include a skipped
required tool, a wrong answer, a missing approval, or a cost increase. Repeat
controls across agents and models before drawing conclusions about run counts.
The CLI default remains three while we gather that evidence.

## Avoid irrelevant paid runs

This repository's maintenance workflow checks the committed diff before exposing
model credentials. It skips only documentation plus known package metadata that
does not enter these source-based evals, such as adding a guide to npm `files`.
Dependencies, dev/optional/peer dependencies, overrides/resolutions, scripts,
engines, package-manager settings, unknown manifest fields, and lockfile changes
all remain relevant. A library upgrade may change Eve or an agent tool even when
no agent source changed. Errors in the preflight run conservatively.

The rule in `scripts/maintenance-relevance.mjs` is specific to this repository.
Do not copy the metadata allowlist to an app that evaluates packaged artifacts or
reads those fields at runtime without checking what enters its evals.
