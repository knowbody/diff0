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
| `--timeout <ms>` | eve default | Per-eval timeout (passed to `eve eval --timeout`) |
| `--max-concurrency <n>` | eve default | Passed to `eve eval --max-concurrency` |
| `--install-mode <mode>` | `scripts-off` | `scripts-off` disables dependency lifecycle/build scripts; `scripts-on` enables them for reviewed refs |
| `--max-spend <usd>` | none | Measured-cost cap; abort (exit 4) when cumulative attributable cost would exceed it |
| `--report-md <path>` | none | Write the markdown report here |
| `--report-json <path>` | none | Write the JSON report here |
| `--json` | off | Print the JSON report to stdout instead of the terminal render |
| `--cache` | off | Opt into the 24-hour base-ref cache; external state is not part of its key |
| `--fail-on <policy>` | `regression` | `regression` \| `drift` \| `never` — what makes exit code 1 |
| `--no-color` | auto | Disable ANSI in terminal render |

Compatibility: `safe` and `trusted` are deprecated aliases for `scripts-off` and `scripts-on`.

Behavior:
- Checks out `base` and `head` into isolated worktrees (never touches the working tree).
- Installs only from exactly one committed lockfile per package root, using frozen/immutable mode.
  `--install-mode scripts-off` disables lifecycle/build scripts; `scripts-on` enables them for applications
  that require generated clients or native package setup. Installs never fall back to mutable resolution. Their
  environment scrubs credential-shaped values and isolates `HOME`, while explicit registry auth
  and copied npm/Yarn registry config remain available for private dependencies. In `scripts-on`
  mode, repository-controlled install scripts can access that registry authentication. Install
  mode is part of the base-cache key because lifecycle scripts may change generated artifacts.
- Interleaves runs: base run 0, head run 0, base run 1, head run 1, … (reduces time-of-day provider drift).
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
- Any comparison-validity mismatch — model, Eve version, sandbox, run count, scored-check set, or
  scored-check coverage — caps the top-level verdict at yellow. Eval rows retain their evidence
  and may say `regressed`, but the summary calls these apparent regressions confounded by validity;
  a mismatched comparison never produces a red gate.
- Fisher-tested skill and subagent drift may be labeled `statistically-confirmed`. Their two-sided
  tests share one Holm family containing every observed skill and subagent hypothesis, including
  unchanged p=1 hypotheses; only changed rows are rendered. Repeated, deterministic differences in
  per-eval tool sequence/count, tool-input fingerprints, or final output fingerprints are labeled
  `stable`; weaker behavioral evidence is `inconclusive`.
- With `--cache`, base-ref results are cached under the repository's resolved Git common directory, normally
  `.git/diff0-cache/`. Cache schema 5's versioned key covers the commit, diff0/Eve versions, model,
  sorted eval filter, timeout, concurrency, install mode, and inferred sandbox. Entries expire after
  24 hours; expired, incompatible, or malformed entries are safe misses. Cached reports warn that
  environment variables and external service state are outside the key; omit `--cache` for release gates.
- Terminal render always goes to stdout (unless `--json`); progress/diagnostics to stderr.
- User env passes through to eval runs untouched; key values are never logged or persisted.

Exit codes:
- `0` — ran to completion; fail-on policy satisfied (note: drift alone is 0 under the default policy)
- `1` — fail-on policy violated (a Holm-adjusted or operational eval regression; or drift when
  `--fail-on drift`)
- `2` — usage/config error: not a git repo, unknown ref, eve not installed in target, **no eval suites**
  (prints the teaching message with a 5-line example eval), bad flag values
- `3` — execution error: eval run crashed / eve exit code 2 / install failure
- `4` — `--max-spend` exceeded (partial results discarded; message says how far it got)

## `diff0 estimate`

```
diff0 estimate --base <ref> [--head <ref>] [options: --repo, --app-dir, --runs, --evals, --install-mode]
```

Performs ONE eval-suite pass on the head ref (or reuses an existing fresh base-cache entry) to measure
per-run cost/tokens/duration, then prints the projected full-comparison cost
(`measured per-run cost x runs x 2 refs`, with the caveat that base/head may differ) and exits 0.
Exit codes 2/3 as above. `--max-spend` accepted and compared against the projection (exit 4 if the
projection exceeds it — lets CI gate before spending).

## JSON report

`renderJson` output (`schemaVersion: 3`) — see `src/report/json.ts`. Version 3 adds:

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
`pricingModel` null so fallback pricing becomes unavailable instead of guessing. The GitHub Action reads `verdict`
(`green|yellow|red`) and `meta` from the JSON artifact. Consumers should reject unknown schema
versions rather than silently assuming an older shape.

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
| `install-mode` | `scripts-off` | `scripts-off` disables install scripts; `scripts-on` enables them for reviewed refs |
| `fail-on` | `regression` | `regression` \| `drift` \| `never` — when to fail the check |
| `max-spend` | none | Measured-cost USD cap passed through; unavailable cost cannot be enforced |
| `working-directory` | `.` | Where the eve app lives (maps to CLI `--app-dir`; the repo root is always the workflow checkout) |
| `github-token` | `${{ github.token }}` | For the sticky comment (needs `pull-requests: write`) |
| `comment-key` | empty | Stable key for an independent sticky report when one PR runs multiple comparisons |
| `allow-untrusted-head` | `false` | Opt in to executing a fork/`pull_request_target` head; only safe in an isolated secret-free job |

The Action: installs deps in the target, runs `diff0 run` with `--report-md`/`--report-json`,
upserts the sticky PR comment for its `comment-key` (find by marker, edit; else create), and sets the
step outcome from the exit code + `fail-on` (drift under default policy = neutral, comment still
posted). An empty key preserves the original `<!-- diff0-report -->` marker.
The caller must use `actions/checkout` with `persist-credentials: false`; the Action refuses a
checkout-persisted HTTP auth header because evaluated head code could recover that job token.
Fork PRs and `pull_request_target` are refused by default because evals, tools, subagents, and
application code execute on the runner; in `scripts-on` install mode, dependency lifecycle/build
scripts execute too. Fork comments are skipped because the ordinary `pull_request` token cannot
write them. Never use `scripts-on` mode for an unreviewed ref or work around this with a privileged
`pull_request_target` job carrying secrets.
