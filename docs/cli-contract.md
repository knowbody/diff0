# diff0 CLI contract (v1)

The stable interface between the CLI, the GitHub Action, and the README. Changes here require
updating all three.

`diff0 --version` prints the installed package version. `diff0 --help` lists the available
commands.

## `diff0 run`

```
diff0 run --base <ref> [--head <ref>] [options]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base <ref>` | (required) | Base git ref (e.g. `main`, `origin/main`, a SHA) |
| `--head <ref>` | `HEAD` | Head git ref |
| `--repo <path>` | `.` | Target repo (must be a git repo with an eve app + evals) |
| `--app-dir <path>` | `.` | Path of the eve app *within* the repo (for monorepos / fixtures) |
| `--runs <n>` | `3` | Eval-suite executions per ref |
| `--evals <filter>` | all | Eval id/prefix filter; repeatable or comma-separated (passed through as eve eval positional ids) |
| `--validity-path <glob>` | none | Additive repo-relative validity glob; repeatable or comma-separated |
| `--timeout <ms>` | eve default | Per-eval timeout (passed to `eve eval --timeout`) |
| `--max-concurrency <n>` | eve default | Passed to `eve eval --max-concurrency` |
| `--install-mode <mode>` | `scripts-off` | `scripts-off` disables dependency lifecycle/build scripts; `scripts-on` enables them for reviewed refs |
| `--max-spend <usd>` | none | Measured-cost stop threshold; checked after each atomic suite run, so it may overshoot by one run |
| `--max-cost-increase-pct <pct>` | `25` | Maximum directional median cost increase |
| `--max-input-token-increase-pct <pct>` | `100` | Maximum directional median uncached-input-token increase |
| `--max-output-token-increase-pct <pct>` | `100` | Maximum directional median output-token increase |
| `--max-duration-increase-pct <pct>` | `100` | Maximum directional median duration increase |
| `--report-md <path>` | none | Write the markdown report here |
| `--report-json <path>` | none | Write the JSON report here |
| `--json` | off | Print the JSON report to stdout instead of the terminal render |
| `--cache` | off | Opt into the 24-hour base-ref cache; external state is not part of its key |
| `--fail-on <policy>` | `regression` | One legacy policy, or comma-separated granular enforcement categories |
| `--no-color` | auto | Disable ANSI in terminal render |

Compatibility: `safe` and `trusted` are deprecated aliases for `scripts-off` and `scripts-on`.

Legacy `--fail-on regression|drift|never` semantics are unchanged. Granular mode accepts any
comma-separated selection of `eval-regression`, `score-regression`, `performance-regression`,
`behavioral-drift`, and `comparison-validity`; mixing legacy and granular names is invalid.
Performance budgets are increase-only, so improvements never violate them. Explicit budget flags
override the corresponding built-in default.

Behavior:
- Checks out `base` and `head` into isolated worktrees (never touches the working tree). A literal
  `HEAD` is rejected when the target checkout is dirty because uncommitted changes cannot enter a
  detached worktree.
- Installs only from exactly one committed lockfile per package root, using frozen/immutable mode.
  `--install-mode scripts-off` disables lifecycle/build scripts; `scripts-on` enables them for applications
  that require generated clients or native package setup. Installs never fall back to mutable resolution. Their
  environment scrubs credential-shaped values and isolates `HOME`, while explicit registry auth
  and copied npm/Yarn registry config remain available for private dependencies. In `scripts-on`
  mode, repository-controlled install scripts can access that registry authentication. Install
  mode is part of the base-cache key because lifecycle scripts may change generated artifacts.
- Counterbalances run order: base/head for even run indexes, head/base for odd indexes. This avoids
  consistently assigning provider warm-up and time-order effects to one ref.
- Before looking at outcomes, fixes a Holm correction family containing every eval with complete
  base and head coverage. Differing pass proportions receive a directional one-sided Fisher exact
  p-value; equal proportions remain in the family as p=1 hypotheses. At family-wise alpha 0.05, a
  significant decrease is `regressed` and a significant increase is `improved`; otherwise the
  direction is reported as inconclusive. Mixed outcomes within one ref do not override a
  significant rate change. If observed proportions are equal, mixed outcomes are labeled flaky
  for the affected ref. Reports expose raw and Holm-adjusted p-values plus the family size.
- A complete all-pass base to all-fail head collapse across at least 3 runs per ref is also an
  operational regression and makes the top-level verdict red, even when a multi-eval Holm family
  leaves the row statistically inconclusive. The row and report still expose the unchanged raw and
  adjusted Fisher evidence; this rule does not relabel the eval as statistically confirmed.
- Records the expected suite-run count on each side of every eval. An eval observed in fewer than
  the expected runs is `partial-base`, `partial-head`, or `partial-both`: a yellow, inconclusive
  coverage warning with no like-for-like Fisher claim. An eval absent from every run on one side
  remains `missing-base` or `missing-head`.
- Treats scorer-only movement separately from pass-rate evidence. Reports include base/head score
  medians, their delta, an absolute materiality threshold of 0.1, and a classification. A median
  drop of at least 0.1 is a material score regression and makes the verdict yellow; it is not
  promoted to a statistically confirmed pass-rate regression. Scored checks align by check name
  plus repeated-name occurrence, not array position. A changed scorer set or scorer missing from
  any expected run is a comparison-validity warning; sparse coverage is not summarized as a soft
  score delta.
- Any comparison-validity mismatch — changed files under the selected app's `evals/` directory or
  an additive `--validity-path` glob, authored sandbox configuration, model, Eve version, run
  count, scored-check set, or scored-check coverage — caps the
  top-level verdict at yellow. Eval rows retain their evidence
  and may say `regressed`, but the summary calls these apparent regressions confounded by validity;
  a mismatched comparison never produces a red gate.
- Fisher-tested skill and subagent drift may be labeled `statistically-confirmed`. Their two-sided
  tests share one Holm family containing every observed skill and subagent hypothesis, including
  unchanged p=1 hypotheses; only changed rows are rendered. Repeated, deterministic differences in
  per-eval tool sequence/count, tool-input fingerprints, or final output fingerprints are labeled
  `stable`; weaker behavioral evidence is `inconclusive`.
- The actual sandbox selected by Eve is not observable and is reported as `unknown`. The separate
  host-default candidate is a capability probe, not evidence that either ref used that backend.
- With `--cache`, base-ref results are cached under the repository's resolved Git common directory, normally
  `.git/diff0-cache/`. Cache schema 6's versioned key covers the commit, diff0/Eve versions, model,
  sorted eval filter, timeout, concurrency, install mode, and host-default candidate. Entries expire after
  24 hours; expired, incompatible, or malformed entries are safe misses. Cached reports warn that
  environment variables and external service state are outside the key; omit `--cache` for release gates.
- Terminal render always goes to stdout (unless `--json`); progress/diagnostics to stderr.
- Evidence comes from captured eval JSON/events and privacy-preserving fingerprints. Eve traces are
  disabled and are not claimed as a report source.
- User env passes through to eval runs untouched; key values are never logged or persisted.

Exit codes:
- `0` — ran to completion; fail-on policy satisfied (note: drift alone is 0 under the default policy)
- `1` — fail-on policy violated (legacy verdict policy, or any selected granular category appears
  in `report.enforcement.violations`)
- `2` — usage/config error: not a git repo, unknown ref, dirty literal `HEAD`, eve not installed in target, **no eval suites**
  (prints the teaching message with a 5-line example eval), bad flag values
- `3` — execution error: eval run crashed / eve exit code 2 / install failure
- `4` — `--max-spend` exceeded (partial results discarded; message says how far it got)

## `diff0 estimate`

```
diff0 estimate --base <ref> [--head <ref>] [options: --repo, --app-dir, --runs, --evals, --install-mode, --timeout, --max-concurrency]
```

Performs ONE eval-suite pass on the head ref (or reuses an existing fresh base-cache entry) to measure
per-run cost/tokens/duration, then prints the projected full-comparison cost
(`measured per-run cost x runs x 2 refs`, with the caveat that base/head may differ) and exits 0.
`--timeout` and `--max-concurrency` are forwarded to the measurement run and included in its base
cache lookup exactly as they are for `run`. Exit codes 2/3 are as above. `--max-spend` is accepted
and compared against the projection (exit 4 if it exceeds the cap before the full comparison).

## JSON report

`renderJson` output (`schemaVersion: 4`) — see `src/report/json.ts`. Version 4 adds:

- directional `costPerf.regressions` with metric, medians, delta, and threshold;
- `enforcement.violations`, grouped by granular policy category; and
- `meta.hostDefaultSandboxCandidate`, separate from the actual sandbox reported as `unknown`.

It retains the version 3 evidence fields:

- `baseExpectedRuns` / `headExpectedRuns` and the `partial-*` eval statuses;
- soft-score `materialThreshold` and `classification`;
- `evalName` attribution on skill, subagent, tool sequence/count, tool-input, and final-output
  evidence (`null` means Eve could not attribute the observation);
- tool-input fingerprint frequencies and captured-run counts; and
- final-output fingerprint frequencies plus captured/total run counts for both refs.

The public report never contains raw tool inputs, raw final outputs, or their deterministic hashes.
At JSON-render time it replaces internal fingerprints with comparison-local `fp-N` labels. These
labels identify frequency-vector equivalence classes, not content: distinct fingerprints with the
same base/head run-count vector intentionally repeat the same label while their multiplicity is
preserved. This avoids leaking lexical hash order or enabling correlation across reports. The
legacy `baseHashes` / `headHashes` property names therefore contain opaque labels, frequency arrays
contain label/run-count entries, and output character-length sets remain available.

`pricingModel` remains an internal, nullable per-run `RunRecord` field and is not serialized into
the public report. `RunRecord.model` joins the distinct usage-bearing `step.started.modelId` values.
Multiple models, incomplete step attribution, or delegated usage without model identity make
`pricingModel` null so fallback pricing becomes unavailable instead of guessing. The GitHub Action
reads `verdict` (`green|yellow|red`) and `enforcement.violations` from the JSON artifact. Consumers
should reject unknown schema versions rather than silently assuming an older shape.

## Markdown report

Starts with the literal marker `<!-- diff0-report -->` (exported as `REPORT_MARKER` from
src/report/markdown.ts). The Action upserts the PR comment containing that marker.

## GitHub Action inputs (action/action.yml)

| Input | Default | Meaning |
| --- | --- | --- |
| `base` | PR base SHA | Base ref |
| `head` | PR head SHA | Head ref |
| `runs` | `3` | Runs per ref |
| `evals` | all | Eval filter |
| `validity-paths` | none | Comma-separated additive repo-relative validity globs |
| `install-mode` | `scripts-off` | `scripts-off` disables install scripts; `scripts-on` enables them for reviewed refs |
| `fail-on` | `regression` | One legacy policy or comma-separated granular categories |
| `max-spend` | none | Measured-cost stop threshold; checked after each suite run and may overshoot by one run; unavailable cost cannot be enforced |
| `max-cost-increase-pct` | core default (`25`) | Maximum directional median cost increase |
| `max-input-token-increase-pct` | core default (`100`) | Maximum directional median uncached-input-token increase |
| `max-output-token-increase-pct` | core default (`100`) | Maximum directional median output-token increase |
| `max-duration-increase-pct` | core default (`100`) | Maximum directional median duration increase |
| `working-directory` | `.` | Where the eve app lives (maps to CLI `--app-dir`; the repo root is always the workflow checkout) |
| `github-token` | `${{ github.token }}` | For the sticky comment (needs `pull-requests: write`) |
| `comment-key` | empty | Stable key for an independent sticky report when one PR runs multiple comparisons |
| `allow-untrusted-head` | `false` | Opt in to executing a fork/`pull_request_target` head; only safe in an isolated secret-free job |

The Action: installs deps in the target, runs `diff0 run` with `--report-md`/`--report-json`,
upserts the sticky PR comment for its `comment-key` (find by marker, edit; else create), and sets the
step outcome from the exit code + the legacy verdict or selected schema-4 enforcement categories
(drift under the default policy remains neutral; the comment is still posted). An empty key
preserves the original `<!-- diff0-report -->` marker.
The caller must use `actions/checkout` with `persist-credentials: false`; the Action refuses a
checkout-persisted HTTP auth header or checkout v7 `includeIf` credential config because evaluated
head code could recover that job token.
Fork PRs and `pull_request_target` are refused by default because evals, tools, subagents, and
application code execute on the runner; in `scripts-on` install mode, dependency lifecycle/build
scripts execute too. Fork comments are skipped because the ordinary `pull_request` token cannot
write them. Never use `scripts-on` mode for an unreviewed ref or work around this with a privileged
`pull_request_target` job carrying secrets.
