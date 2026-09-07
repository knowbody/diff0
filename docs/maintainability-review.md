# Readability and maintainability review

Archived review from 2026-09-07 against commit `b2763d5`. The review itself changed no application code or dependencies. Source links below are pinned to that baseline; see [the resolution ledger](maintainability-resolution.md) for the subsequent implementation and validation.

The largest maintenance problem is duplicated interpretation of the same facts: options, cost availability, report summaries, verification requirements, and tool permissions. Several copies already disagree. Consolidating these rules has more value than adding general-purpose abstractions or splitting files by size alone.

This report contains 33 findings, grouped by the part of the system they affect. **Critical** means a comparison gate can silently give an incorrect answer; **Worth fixing** means a concrete correctness or maintenance improvement; **Nit** means optional cleanup. Reproduced behavior is explicitly identified. Other findings come from source inspection and are not claims of observed production incidents.

## Scope and verification

Reviewed authored runtime modules under `src/`, the agent and its station prompts/tools, eval definitions, Action source, scripts, workflows, demo fixture/scripts, website components/data/build configuration, and test organization and coverage. Generated bundles, lockfiles, snapshots, and binary assets were considered through their sources and build configuration, rather than treated as handwritten code. This is a broad source review, not a guarantee that every defect has been found.

Checks completed:

- `pnpm test:unit`: **423 tests passed across 23 files**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed; Biome checked **123 files**, with exclusions discussed in finding 28.
- Focused temporary probes against the real analysis, pricing, rendering, and comparison functions reproduced the cases below. Comparison probes used injected adapters/worktrees; they did not run paid evals.
- Inspected the installed dependency manifests for runtime compatibility and checked primary library documentation for replacement candidates.

Integration/package tests, website builds, hosted agent runtime tests, and real-model evals were not run during this review. Existing passing unit tests do not cover the reproduced cases.

## Analysis, validity, and money

### 1. Critical — Make validity inspection failure distinguishable from no changes

Locations: [getChangedPaths](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/gitdiff.ts#L50), [comparison validity handling](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.ts#L217).

Git inspection returns `null` on failure. The runner treats that result like an empty changed-file list. **Reproduced:** injecting `null` for both the eval-harness and sandbox-config inspections produced a green comparison with no validity mismatches.

Use an explicit result such as `{ status: "checked", paths } | { status: "unavailable", reason }`. An unavailable required validity check should either abort collection before it incurs cost or mark comparison validity as unavailable and prevent an unqualified green verdict. Optional diff statistics can remain best-effort. Fetch changed paths once and match both policy sets against that result; the current helpers repeat the same Git query.

Validation: force each inspection failure independently and verify both the verdict and the `comparison-validity` enforcement category. Keep an unchanged, successfully inspected comparison green.

### 2. Critical — Round display values after enforcement, never before it

Locations: [metricStats/metricDelta](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1253), [performanceRegressions](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1329).

Medians are rounded to six decimals, then the percentage change is rounded to one decimal, then budgets compare those rounded results. **Reproduced:** duration medians of `100` and `110.04` with a 10% budget produce `deltaPct: 10` and no regression, even though the actual increase is 10.04%. Costs of `1e-8` and `1e-5` round the base median to zero, producing `deltaPct: null` and no regression. The reported base median is then outside its own min/max range.

Keep full precision in analysis values and budget decisions; format rounded values only in reporters. If the public JSON contract requires rounded fields, retain raw decision values internally or add explicit display fields rather than using rounded values as inputs. Test values just above/below a threshold, tiny positive costs, and zero baselines. A statistics or decimal library is unnecessary to fix this.

### 3. Worth fixing — Validate library options before preparing worktrees or running evals

Locations: [compareRefs](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/runner.ts#L19), [runComparison](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.ts#L183), [threshold validation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1306), [CLI parsers](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L113).

Validation is spread between Commander, the harness, and late analysis. **Reproduced:** `compareRefs` with `performanceThresholds: { durationMs: -1 }` ran both mock suites before rejecting the threshold. Library callers also lack the CLI's consistent checks for spend, timeout, and concurrency values. Positive-integer parsing should reject unsafe integers as well.

Introduce reusable option normalization at the public boundary, before ref resolution or collection. Let the CLI use the same validators, while retaining defensive checks in independently exported pure functions. Cover invalid options by asserting that no worktree/adapter call occurs. This should precede any broader runner refactor.

### 4. Worth fixing — Define one cost availability and provenance model

Locations: [applyPricing](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/pricing.ts#L62), [totalCost](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L280), [usableCosts](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1272), [estimate cost selection](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L229).

**Reproduced:** base costs `[0, 1, 1]` and head costs `[1, 1, 1]` yield an unavailable comparison total but usable cost statistics. The pricing layer labels all non-null records as gateway priced; the estimator rejects any zero; analysis accepts a mixed zero/positive sample but rejects an all-zero sample. Applying pricing again to fallback-priced records also loses their original provenance because only the batch result carries the source.

Choose the intended meaning of a measured zero versus an unknown/mock cost and encode it once. Prefer per-record provenance, with a compatibility adapter for the existing `costUsd` field, or at minimum centralized availability/aggregation helpers. Keep mixed gateway/table pricing explicit. Test zero, unknown, mixed sources, repeat application, and tiny positive values across total, estimates, budgets, JSON, and human reports.

### 5. Worth fixing — Validate external JSON with schemas instead of casts and parallel handwritten guards

Locations: [price loading](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/pricing.ts#L49), [cache guard](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/cache.ts#L131), [Eve normalization](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L362), [price refresh](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/scripts/refresh-prices.mjs#L12).

**Reproduced:** a valid JSON price file containing `{"models":null}` crashes during lookup; a string rate such as `"oops"` produces `NaN` and a `priced-tokens` label. The refresh script also calls `Number()` without checking the converted rates before overwriting the table. Meanwhile the cache maintains more than a hundred lines of manual shape validation, and Eve data enters through asserted interfaces.

Use schemas for consumed external fields: finite nonnegative prices/usage/durations, required collection shapes, and cache record envelopes. Permit unrelated upstream fields so additions do not break compatibility. Distinguish malformed explicit configuration from an unavailable optional fallback. Validate a generated price table before replacing the committed file.

Zod is already used by the agent, so its `safeParse` and inferred types are a good fit. It is currently a dev dependency; using it in published `src/` requires making it a production dependency and checking the packed package and Action bundle. Do not validate every internal function repeatedly. [Zod documentation](https://zod.dev/basics).

### 6. Worth fixing — Give report summaries a single producer

Locations: [Markdown overview](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/markdown.ts#L271), [Markdown statistics](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/markdown.ts#L302), [terminal evaluation details](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/terminal.ts#L362), [format helpers](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/format.ts#L1).

**Reproduced:** an eval present and passing in only one of two base runs is shown as `1/1` under “Evals passing every run.” The overview compares passed count with observed count without requiring complete coverage. Analysis already knows the coverage is partial, but the renderer independently reconstructs the claim.

Compute presentation facts from analysis once: complete-coverage pass counts, tool-call statistics, status detail, metric labels, budget explanations, and p-value display rules. Let Markdown and terminal render the same facts with different layout/escaping. Keep Markdown escaping and terminal sanitization separate because their output contexts differ. Add a report-level test where observed counts differ from expected counts.

### 7. Worth fixing — Split analysis along existing domain boundaries

Locations: [delta.ts](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L99), [eval aggregation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L355), [drift](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1069), [enforcement/verdict](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1398).

The 1,761-line module owns metadata comparability, eval outcomes, statistical tests, tool/input/output drift, performance, enforcement, verdict prose, and caveats. Changing one policy requires navigating many unrelated invariants. Skill and subagent drift use closely parallel accumulation/classification paths.

Extract modules for statistical primitives, eval deltas, behavioral drift, performance, and verdict/enforcement. Leave `computeDelta` as the assembly function. Share the narrow occurrence-comparison primitive between skill/subagent drift while retaining explicit domain labels. Avoid a configurable scoring framework. Preserve existing statistical semantics and report fixtures during the move; functional fixes should remain separately reviewable.

### 8. Worth fixing — Share tiny numeric/sequence primitives; keep domain statistics explicit

Locations: [analysis median](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L580), [estimate median](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L110), [Markdown stats](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/markdown.ts#L315), [sameStrings](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L956), [sequencesEqual](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/analyze/delta.ts#L1062).

There are three median implementations and two equivalent ordered-string comparisons. A small numeric module with an explicit empty-input policy, plus one sequence equality helper, removes these independent maintenance points. Round only at display boundaries, as in finding 2.

Do not add a statistics package solely for median. Fisher exact tests, directional hypotheses, and Holm correction deserve named modules, explanatory tests, and known-answer cases. Replacing them with a library is justified only after verifying tail conventions, precision, and parity with the current policy.

## Collection, CLI, and process boundaries

### 9. Worth fixing — Separate process execution from the Eve adapter

Locations: [runCommand](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L197), [usage normalization](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L362), [worktree commands](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L158).

The Eve adapter owns a general subprocess runner that worktree/install code imports. This makes generic infrastructure depend on a specific host adapter. The same file also handles discovery, hashing, JSON extraction, usage attribution, and command lifecycle. `summaryToRunRecord` uses multiple mutable counters/flags to reconcile root, delegated, and legacy usage.

Extract process execution into its own module and Eve JSON/usage normalization into adapter-local modules. A per-eval usage accumulator with explicit attribution rules would make those branches easier to reason about. Validate nonnegative timestamp spans: `isoSpanMs` currently accepts a reversed timestamp pair.

Execa is a candidate for the subprocess layer because it supports timeouts, cancellation, and output limits. First prove parity for descendant termination, interrupted commands, bounded stdout/stderr, and Eve's meaningful nonzero exits. Do not swap it in merely to reduce line count. [Execa termination documentation](https://github.com/sindresorhus/execa/blob/main/docs/termination.md).

### 10. Worth fixing — Reuse collection preparation and probe metadata

Locations: [runner preparation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.ts#L183), [estimate preparation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L122), [Eve probe](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L614), [getAgentInfo](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L768).

Runner and estimator repeat ref/worktree preparation, app resolution, sandbox selection, discovery, agent metadata, and cache-key inputs. Eve's `probe()` already obtains agent info, but preparation separately calls the agent-info helper. The repeated external probes add latency and can disagree if one fails.

Create a narrow prepared-app result carrying the resolved ref, app path, adapter version, eval IDs, sandbox evidence, metadata, and cleanup handle. Return or reuse already-probed metadata. Preserve base/head-specific evidence rather than collapsing the two refs into one shared configuration.

### 11. Worth fixing — Align estimate assumptions with the cache policy of the planned run

Locations: [estimate cachedBaseRuns](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L236), [compareRefs cache default](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/runner.ts#L19), [run flags](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L465).

The estimator treats a cached base sample as all requested base runs being free. `compareRefs` and the CLI default to no cache reuse. Thus an estimate can project head-only charges for a following default run that executes both refs. This is a policy mismatch observed in source, not a billing incident reproduced here.

Separate “use cache as estimation evidence” from “the planned comparison will reuse cache.” Make planned cache behavior an explicit shared option, and show the assumption in the estimate. Test a valid cached base with planned reuse both enabled and disabled.

### 12. Worth fixing — Keep test dependencies separate from public comparison options

Locations: [RunComparisonOptions](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.ts#L102), [EstimateOptions](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L36), [CliHarnessSeams/applySeams](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L254).

Public options mix user configuration with individual replacements for worktrees, cache I/O, ref resolution, sandbox inference, and Git inspection. The CLI duplicates those seams and copies them field by field. Adding a dependency changes several unrelated interfaces.

Group internal dependencies in a typed object or create an internal runner factory. Keep supported host-adapter customization explicit. Since the API is published as a preview, migrate existing callers deliberately rather than silently removing injection fields. Reuse the same dependency object in CLI/library tests.

### 13. Worth fixing — Define common CLI options and typed errors once

Locations: [CLI parsers](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L113), [exitCodeForError](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L210), [estimate rendering](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L361), [command registration](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/cli.ts#L465), [install error matching](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L438).

Run and estimate repeat flag registration, flag types, normalization, and mapping. Error classification additionally depends on message regular expressions; install timeout classification searches for “timed out after.” Editing prose can change exit behavior. Estimate rendering lives inside the already broad CLI module.

Keep Commander, extract common option registration/normalization, move estimate formatting to the reporter area, and introduce typed configuration/ref/command-timeout errors with stable codes and causes. Map codes to exit status at the CLI boundary. Keep error messages free to improve without changing program behavior.

### 14. Worth fixing — Make cleanup failures observable without replacing the primary error

Locations: [worktree cleanup](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L219), [install cleanup](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L438), [runner cleanup](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.ts#L419), [estimate cleanup](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.ts#L267).

The harness suppresses cleanup failures, while `createWorktree` can replace an install error if its cleanup throws. The isolated-home `finally` can also replace the original failure. Worktree pruning happens before the fallback directory removal, so a failed Git removal can leave stale metadata until a later prune.

Centralize cleanup result handling: always attempt owned-resource cleanup, preserve the primary error, and surface secondary failures through progress diagnostics or an aggregate/cause. Prune after fallback directory removal when needed. Test an install failure combined with cleanup failure, and successful execution with failed cleanup.

### 15. Worth fixing — Separate installation planning from worktree lifecycle

Locations: [workspace detection](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L44), [installDependencies](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L264), [nested installs](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L353), [environment isolation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/worktree.ts#L411).

The worktree module combines path containment, workspace parsing, lockfile selection, package-manager commands, credential scrubbing, registry configuration copying, and lifecycle management. These concerns change for different reasons.

Extract a pure installation plan from lockfiles/workspace metadata, then execute that plan through the shared process runner. Keep environment sanitization as an explicit boundary. A table of supported package managers is clearer than distributing their command details through the lifecycle. Existing `yaml` and `minimatch` are appropriate; a Git wrapper or package-manager detection library would not remove the important security/install policy.

### 16. Worth fixing — Make the declared Node support match production dependencies

Locations: [package engines/dependencies](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/package.json#L29), [minimum-version smoke test](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/.github/workflows/ci.yml#L70), [documented requirement](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/README.md#L63).

The package advertises Node >=20, but the installed production dependency Commander 15.0.0 declares Node >=22.12.0. This was verified from `node_modules/commander/package.json`. CI installs on Node 24 and then runs `--help` on Node 20; that does not exercise installation with engine enforcement on Node 20.

Either choose a Commander release whose supported engines include the advertised minimum, or raise the package/documented minimum. Add an isolated consumer install with engine enforcement at the supported floor, plus CLI/library smoke coverage. This is an install/support-contract mismatch; the existing smoke test means it would be inaccurate to claim the CLI always crashes on Node 20.

## Reports and automation

### 17. Worth fixing — Measure terminal columns rather than UTF-16 length

Locations: [wrapTokens](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/terminal.ts#L60), [packSegments](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/terminal.ts#L103), [metric/run rows](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/terminal.ts#L527).

Wrapping/padding uses `.length`, `.slice()`, and `padEnd()`. Non-ASCII eval names, tool names, and refs can contain wide characters, combining marks, or emoji. Column width then differs from string length, and arbitrary slicing can break a surrogate pair. The existing long-token split also contradicts the nearby “never split” intent.

Use `string-width` for display measurement and width-aware padding. Use grapheme-safe splitting or an appropriate wrapping helper for long tokens, preserving the existing sanitization before formatting. Test CJK, combining marks, emoji, and long names. This is a better dependency tradeoff than maintaining Unicode width tables. [string-width documentation](https://github.com/sindresorhus/string-width).

### 18. Worth fixing — Make public redacted reports distinct in the type system

Locations: [opaqueFingerprintLabels](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/json.ts#L10), [PublicReport](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/json.ts#L67), [fingerprint fields](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/types.ts#L24).

`PublicReport` is `DeltaReport & { schemaVersion }`, although its hash fields now contain opaque labels rather than internal fingerprints. Both remain interchangeable strings in essentially the same structure, obscuring the privacy boundary for callers and future reporters.

Define an explicit public projection, or brand internal fingerprints and public labels. Keep conversion centralized. Preserve equality/frequency relationships when relabeling; simply giving every occurrence a unique label would change report meaning. Add compile-time consumer coverage that publishing paths require the public projection.

### 19. Nit — Consolidate stable serialization only with a precise compatibility contract

Locations: [stableStringify](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/adapters/eve.ts#L326), [sortKeysDeep](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/report/json.ts#L50).

Both recursively order keys for deterministic JSON. Share a small helper if its handling of arrays, undefined values, and unusual values can be documented identically. Hashing is a compatibility-sensitive use: retain golden fingerprints, or intentionally version the affected cache/schema when serialization changes.

A stable-stringify package is optional, not an urgent addition. It must support the exact semantics and pretty-output requirements of its consumers; replacing a short, tested helper without removing meaningful complexity is a poor tradeoff.

### 20. Worth fixing — Move Action policy logic out of embedded shell/JavaScript

Locations: [Action preflight](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/action/action.yml#L145), [Action enforcement](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/action/action.yml#L266), [Action entry/build sources](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/scripts/action-entry.ts#L1), [Action tests](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/test/action-upsert.test.ts#L1).

The composite action embeds option parsing, schema checks, enforcement categories, and hardcoded JSON schema version 4 across Bash and inline Node programs. These duplicate the CLI/core policy. Tests that extract source snippets from YAML couple correctness checks to formatting and implementation layout.

Author typed preflight/enforcement entrypoints, bundle them using the existing Action build, and leave YAML responsible for wiring inputs, steps, and outputs. Reuse category/schema constants and policy normalization. Preserve the sequence that publishes the report before enforcing the requested gate. Test executable entrypoints with input/output fixtures instead of extracting their source from YAML.

### 21. Worth fixing — Consolidate GitHub transport with bounded, operation-aware retries

Locations: [agent API wrapper](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/api.ts#L21), [repository metadata fetch](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/git-remote.ts#L70), [Action request/pagination](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/action/upsert-comment.mjs#L97), [review validation script](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/scripts/validate-reviewed-pr.mjs#L1).

Several callers maintain JSON response handling, error text, pagination, and request policy separately. The Action retries retryable HTTP statuses immediately without backoff/Retry-After handling. Requests do not consistently have their own deadline; an optional abort signal alone does not impose one.

First inspect whether the existing GitHub SDK offers the required transport. Otherwise Octokit is a credible replacement for REST types, pagination, and established retry/throttling behavior. Keep small app-specific wrappers for repository scope and allowed operations. For the Action, bundle it rather than requiring dependency installation in the consumer workflow. Preserve pagination origin checks and the existing recovery against duplicate comment creation; retrying non-idempotent POSTs blindly is unsafe. [Octokit documentation](https://github.com/octokit/octokit.js).

## Agent and eval maintainability

### 22. Worth fixing — Enforce publication memory limits before retaining all file bodies

Locations: [file read/validation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/runtime-push.ts#L165), [parallel collection](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/runtime-push.ts#L232).

Up to 500 paths are read through `Promise.all`. Each file's 4 MiB limit is checked after the complete read, and the 24 MiB total is checked only after all results are retained. At the allowed per-file bound, the aggregate can approach 2 GiB before rejection, with up to 500 concurrent sandbox operations. An individual oversized file is also fully allocated before its size check. This is a bound-ordering issue established from source, not a load test.

Check committed object sizes before reading, then use sequential or bounded reads with a running total that stops further collection when the budget is exhausted. Use bounded streaming if the sandbox API supports it. `p-limit` can cap concurrency when throughput warrants it, but it does not by itself cap the retained results of `Promise.all`; sequential collection is simpler under a 24 MiB budget. Preserve immutable blob-SHA and working-tree byte verification.

### 23. Worth fixing — Share checkout mechanics and clean-commit validation without merging station policies

Locations: [implementer checkout](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/implementer/tools/checkout_branch.ts#L1), [reviewer checkout](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/reviewer/tools/checkout_branch.ts#L1), [reviewedSha](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/review-checks.ts#L46), [attest_review](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/reviewer/tools/attest_review.ts#L30).

The two checkout tools repeat ownership validation, brokered fetch/checkout, and policy restoration. The reviewer returns success after `rev-parse` without checking its exit status or SHA format, unlike the implementer's stricter path. Attestation also repeats the clean-branch/SHA logic already owned by `reviewedSha`.

Extract a checked fetch-and-resolve helper and reuse clean-commit validation in attestation. Keep before/after checks around verification. Preserve the intentional marker difference: implementer revisions update the revision baseline, while the reviewer needs the original comparison baseline. Keep separate filesystem tool entrypoints because Eve uses those paths as identities.

### 24. Worth fixing — Give verification requirements one executable source

Locations: [reviewCheckPlan](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/review-checks.ts#L17), [implementer prompt](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/implementer/instructions.md#L21), [reviewer prompt](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/reviewer/instructions.md#L31), [CI](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/.github/workflows/ci.yml#L30), [workflow routing test](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/test/workflow-routing.test.ts#L1).

Requirements are distributed across prompts, code, workflow filters, scripts, and AGENTS guidance. Examples already differ: the implementer prompt uses `--fail-on regression` while the executable reviewer plan uses `--fail-on drift`; CI includes the packed-library test while the reviewer plan does not; the required station runtime proof is a separate script not run in regular CI. The fixture comparison workflows deliberately route on fixture paths, while agent guidance requires comparison evidence for engine/Action changes too.

Define named checks and scope predicates centrally, then have the reviewer plan and CI contract tests consume them. Explain intentional differences, such as stronger reviewer gating or runtime tests that run separately. Prompts should refer to executable checks rather than maintain alternate command/policy lists. Preserve the app-owned nature of verification: model-provided claims must never substitute for command results.

### 25. Worth fixing — Derive or parity-check the write-tool inventory used by evals

Locations: [write-tool lists](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/evals/helpers.ts#L3), [extension configuration](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/extensions/github/extension.ts#L1), [smoke eval](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/evals/smoke.eval.ts#L2), [prompt-injection eval](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/evals/safety/prompt-injection.eval.ts#L2), [read-only eval](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/evals/safety/read-only-question.eval.ts#L2).

The comment says newly added extension write tools are automatically forbidden, but the inventory is a manually maintained array. Smoke and prompt-injection evals assert over `GITHUB_WRITE_TOOLS`; the dedicated read-only case uses the larger `WRITE_TOOLS` union including `update_factory_brain`. Coverage differs without a shared, enforced policy.

Derive the inventory from mounted descriptors where feasible, or add a deterministic parity test between mounted write capabilities and the expected list. Have all read-only scenarios use the same union unless a scenario documents an exception. Keep the existing trust/approval modules as the authority; this change strengthens tests rather than relocating authorization into evals.

### 26. Worth fixing — Encode successful and failed tool results as distinct shapes

Locations: [artifact output schemas](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/artifacts/tools.ts#L96), [read artifact result](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/artifacts/tools.ts#L146), [attestation output](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/subagents/reviewer/tools/attest_review.ts#L80), [Blob write helper](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/blob.ts#L50).

Schemas with a boolean plus many optional fields admit states such as `saved: true` without an ID, `found: true` without document content, or successful attestation without a SHA. The artifact reader catches storage errors and reports `found: false`, making a storage outage indistinguishable from a missing artifact. The shared document writer also sets Markdown content type for callers that store JSON state.

Use discriminated success/error or found/missing/unavailable results, requiring the corresponding data. Check the pinned Eve tool-schema support before changing output shapes. Keep invalid/cross-scope IDs nondisclosing while reporting operational failures as unavailable. Add an explicit content type or dedicated Markdown/JSON helpers. Zod is already present here; no new result-wrapper library is needed.

### 27. Worth fixing — Exercise the complete failure/drift path in deterministic integration coverage

Locations: [adapter integration](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/m1.integration.test.ts#L1), [CLI integration](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/m2.integration.test.ts#L1), [drift demo](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/demo/mock-demo.sh#L75), [pipeline evals](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/evals/pipeline).

The two integration fixtures compare a cosmetic change with unchanged behavior. They verify useful collection and cache plumbing, but do not prove that a known behavioral change travels through real collection, analysis, reports, and exit enforcement. The deterministic drift case already exists in the demo script. Pipeline eval station ordering/text judgments likewise provide less assurance than checking durable publication/review outcomes.

Reuse the deterministic skill-removal scenario in the existing CLI integration suite and assert the actual drift category, report evidence, and exit policy. Keep genuine Git integration coverage. For agent pipeline coverage, add deterministic assertions at durable state boundaries using the existing mocks; do not introduce paid or mutating evals into every ordinary test run.

## Tooling, website, and small cleanup

### 28. Worth fixing — Make typecheck/lint coverage match the repository's authored code

Locations: [Biome includes](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/biome.json#L3), [root TypeScript config](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/tsconfig.json#L18), [agent TypeScript includes](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/tsconfig.json#L13), [website build job](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/.github/workflows/ci.yml#L81).

Root typechecking includes `src/`; agent typechecking adds only three root test files. Most `test/` files are executed through Vitest without being typechecked. Biome's explicit includes omit most root tests, scripts, and the website. The website has a separate build check, but no equivalent lint coverage. A green “lint/typecheck” result therefore covers less than the script names suggest.

Add a no-emit test/tooling tsconfig, extend Biome's authored-code includes, and run the website's lint/type checks in its own workspace. Keep generated bundles, fixture dependencies, and assets excluded. Share sensible strict compiler defaults where compatible; keep different module-resolution needs explicit. A monorepo framework is unnecessary for this.

### 29. Worth fixing — Reuse typed test fixtures and narrow fake interfaces

Locations: [shared records](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/test/helpers/records.ts#L1), [runner tests](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/runner.test.ts#L1), [estimate tests](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/estimate.test.ts#L1), [spend tests](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/harness/max-spend.test.ts#L1), [agent runtime tests](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/test/agent-runtime.test.ts#L1).

Several suites independently construct adapters, RunRecords, scratch Git repositories, worktrees, and cache responses. Broad casts such as `as never` in sandbox fakes hide interface drift, especially where tests are outside typechecking. Integration setup is duplicated too.

Extend the existing fixture builders with typed adapter/worktree helpers and small `Pick<SandboxSession, ...>` ports where production helpers need only a subset. Keep scenario-specific differences visible in each test. Reuse scratch-repo setup and restore environment variables to their prior values rather than always deleting them. Avoid a universal test harness that conceals what a scenario actually exercises.

### 30. Worth fixing — Keep website evidence as structured data through rendering

Locations: [showcase adapter](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/lib/showcase.ts#L12), [showcase JSON](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/content/showcase.json#L1), [OG generation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/scripts/gen-og.mjs#L19), [PR comment](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/components/PrComment.tsx#L47).

Metrics are found by display label and shortened by splitting formatted strings on spaces. The OG generator repeats those label lookups. Additional counts and explanatory claims live in components alongside the structured showcase, so editing the example requires checking multiple representations.

Use stable metric IDs and numeric source values, then derive display strings, passing counts, and summaries in one content adapter. Generate web and OG evidence from that model. Keep the source PR and snapshot/version explicit: historical example results should not silently become claims about the current product. A build-time schema check is sufficient; no CMS/data-state library is needed.

### 31. Worth fixing — Correct copy feedback and give website sections clear ownership

Locations: [CopyButton](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/components/CopyButton.tsx#L15), [Home](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/app/page.tsx#L83), [PrComment helpers](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/components/PrComment.tsx#L3), [theme initialization](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/app/layout.tsx#L42), [theme toggle](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/website/components/ThemeToggle.tsx#L3).

The clipboard fallback ignores the boolean result of `execCommand("copy")` and then announces success; an exception can leave its textarea attached. Its timeout is not cleaned up on unmount. Check actual success, clean up the temporary element in `finally`, clear the timer on unmount, and offer accurate failure feedback. This is small enough to keep local rather than adding a clipboard package.

Separately, `Home` combines most page sections in one large component. Extract sections with clear content boundaries and reuse existing card/table primitives where repetition is real. Centralize repeated design values in the existing CSS variables. If theme logic grows, share its storage key/value normalization; the present two-class toggle does not justify a theme framework by itself.

### 32. Worth fixing — Make the deterministic demo run current code in isolated scratch space

Locations: [mock demo build](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/demo/mock-demo.sh#L47), [mock demo scratch path](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/demo/mock-demo.sh#L23), [real demo setup](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/demo/setup.sh#L1).

The mock demo skips the build whenever `dist/cli.js` exists, so a maintainer can edit source and then validate an older binary. Fixed `/tmp` paths also let concurrent demo runs remove each other's repositories. The copy-then-delete of `node_modules` performs avoidable work compared with excluding it during the copy.

Build by default, or require an explicit use-existing-build option. Use `mktemp` with a documented retention/cleanup policy and exclude dependency/runtime directories while copying. Share the small fixture-preparation portion between scripts where their behavior is identical.

### 33. Nit — Remove misleading comments and history-based names

Locations: [normalized type header](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/types.ts#L1), [branch validator documentation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/github/git-remote.ts#L30), [artifact tool documentation](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/agent/lib/artifacts/tools.ts#L28), [integration names](https://github.com/knowbody/diff0/blob/b2763d5067431169f9b87f7abe0df44289a65662/src/collect/m1.integration.test.ts#L1).

The normalized model still says Eve is the only producer despite the published host/library API. The branch-name validator comment says protected branches are refused, but that policy belongs to `validateBranch`, not `validateBranchName`. Several small tool modules spend more lines restating signatures than explaining behavior. Names such as `m1`/`m2` describe milestones rather than the contracts tested.

Correct stale statements, rename tests by behavior, and trim repetitive `@param`/`@returns` prose. Retain explanations of trust boundaries, byte identity, process-group handling, and statistical decisions. These comments carry information the code alone does not make obvious.

## Library decisions

These are adoption recommendations, not claims of measured bundle-size savings. Select versions against the package's supported Node floor and the pinned Eve runtime; current documentation can describe newer releases.

| Candidate | Decision | Where it earns its dependency cost | Conditions |
| --- | --- | --- | --- |
| [Zod](https://zod.dev/basics) | Adopt for consumed external JSON; reuse in the agent | Cache records, price tables, Eve summaries, selected external API payloads | Promote to runtime dependency if imported by published core; preserve tolerant upstream fields; test packed exports |
| [string-width](https://github.com/sindresorhus/string-width) | Adopt | Terminal column measurement and padding | Pair with safe wrapping; retain terminal sanitization |
| [Octokit](https://github.com/octokit/octokit.js) | Strong candidate for a focused transport refactor | Repeated GitHub REST, pagination, throttling, request errors | Check existing SDK first; preserve operation-specific retry/credential policy; bundle Action code |
| [Execa](https://github.com/sindresorhus/execa/blob/main/docs/termination.md) | Conditional replacement | Subprocess lifecycle and structured errors | Prove process-tree cancellation, timeout, buffer, and accepted-exit parity |
| [p-limit](https://github.com/sindresorhus/p-limit) | Optional | A bounded publication read queue if sequential reads are too slow | Does not solve total memory retention or cancellation by itself |
| [fast-json-stable-stringify](https://github.com/epoberezkin/fast-json-stable-stringify) | Low priority | Only if stable serialization grows beyond the current two consumers | Verify exact JSON/hash semantics; do not assume pretty-print support |
| Commander, yaml, minimatch, markdown-table, picocolors | Keep their current roles | CLI parsing, workspace data/globs, Markdown tables, color | Resolve Commander's Node engine mismatch in finding 16 |
| General utility/statistics/Git/UI frameworks | No addition justified now | Existing small helpers and explicit domain rules are easier to own | Reconsider only for a demonstrated need, not line-count reduction |

## Suggested implementation order

1. Correct findings 1–6 and 16 with focused behavioral tests. They concern trust in comparison output, avoiding wasted eval work, and installation support.
2. Extract the shared option/error/schema and analysis/presentation boundaries in findings 7–15 and 18. Keep each move separate from semantic changes where practical.
3. Consolidate Action/GitHub transport and agent verification/tool policies; fix publication memory ordering before broad agent cleanup.
4. Close tooling/integration gaps, then address website/demo maintenance. Leave the nits until touching those files for substantive work.

The single highest-leverage change is to give each comparison fact one typed owner: validate inputs before collection, compute unrounded analysis facts once, and make every renderer and enforcement path consume those same facts.
