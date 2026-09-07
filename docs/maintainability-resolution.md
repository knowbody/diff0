# Maintainability review: implementation and verification map

This document maps all 33 findings in [the original review](maintainability-review.md) to the implementation and its verification. It describes the implementation and completed local validation before PR submission. Hosted PR checks and generated-bundle parity against the submitted commit remain the orchestrator’s responsibility. No completed PR, merge, or deployment is implied.

“Implemented” means the corresponding change is present in source. Test references identify the relevant executable coverage; the focused checks actually completed are recorded separately below. Existing trust boundaries, the independently executed reviewer station, the approved coding-model trial, and inconclusive statistical classifications remain part of the contract.

## Analysis, validity, and money

### 1. Required validity inspection failures — implemented

[inspectValidity](../src/harness/gitdiff.ts) returns a checked/unavailable union and obtains one changed-path snapshot for both evaluator and sandbox policies. The [runner](../src/harness/runner.ts) treats unavailable evidence, including failures from supported legacy injected inspectors, as a comparison-validity mismatch. Optional file statistics remain best-effort.

Verification: [validity tests](../src/harness/validity.test.ts) independently fail each legacy inspector, require the non-green validity outcome, and preserve green for successfully inspected unchanged refs. Existing [Git inspection tests](../src/harness/gitdiff.test.ts) retain matching/path coverage.

### 2. Decision precision — implemented

[Numeric primitives](../src/numeric.ts) retain raw medians and percentage changes. [Performance analysis](../src/analyze/performance.ts) compares the actual metric amount against its permitted amount, with a narrowly bounded floating-point tolerance for mathematically equal decimal budgets. [Budget presentation facts](../src/report/facts.ts) retain enough precision to explain a just-over-threshold result accurately.

Known-zero baselines now retain an amount-based regression decision even though percentage change is undefined. `PerformanceRegression.deltaPct` is `number | null`; the public report schema advances to version 5, JSON remains finite, and reporters explain the amount change. The preview compatibility detail is documented in [the library API](library-api.md).

Verification: [delta tests](../test/delta.test.ts) cover known-zero increases, unchanged/decreasing zero comparisons, 100→110.04 with a 10% budget, just-under-threshold values, tiny positive costs, and the exact 1→1.1 decimal boundary. [Statistics tests](../test/statistics.test.ts) also exercise extreme finite medians.

### 3. Validate before side effects — implemented

[Shared options](../src/options.ts) validate safe positive integers, spend, Node timer bounds, app paths, eval filters, install modes, and validity patterns. The [public runner](../src/runner.ts) and [harness](../src/harness/runner.ts) validate collection options and performance thresholds before ref resolution, worktrees, or eval execution. CLI parsers consume the same rules.

Verification: [public runner tests](../test/runner-api.test.ts), [CLI tests](../src/cli.test.ts), and [harness tests](../src/harness/runner.test.ts) cover invalid inputs and assert that execution dependencies were not called.

### 4. Cost availability and provenance — implemented with an explicit compatibility rule

[cost.ts](../src/cost.ts) owns `availableCost`, `usableCosts`, and source aggregation. [RunRecord](../src/types.ts) has optional per-record `costSource`; [pricing](../src/collect/pricing.ts) preserves fallback provenance on repeated application. Analysis and estimation consume the same complete-sample rule.

Compatibility: a legacy zero with no provenance remains unavailable, preserving conservative treatment of mock usage. A zero explicitly marked `gateway` or `priced-tokens` is a known measured value. Custom adapters can state that distinction. Mixed gateway/table data retains the table-pricing qualification.

The Eve adapter preserves gateway provenance for complete reported costs, including zero. [Adapter-to-enforcement tests](../src/adapters/eve-cost.test.ts) cover a measured zero increasing to a positive cost, decreases to zero, unchanged zero, and legacy caller records without provenance. This closes the independent review finding that normalization could discard the source before the performance gate evaluated it.

Verification: [pricing tests](../src/collect/pricing.test.ts), [delta tests](../test/delta.test.ts), and [estimate tests](../src/harness/estimate.test.ts) cover missing, mixed, legacy-zero, explicitly sourced zero, repeated pricing, and tiny values.

### 5. External JSON schemas — implemented

[Run-record schemas](../src/schema/run-record.ts) replace the cache's manual shape checker; [cache envelopes](../src/collect/cache.ts) use the same normalized record contract. [Price loading](../src/collect/pricing.ts) validates finite nonnegative rates. [Eve JSON validation](../src/adapters/eve-json.ts) checks consumed collection, score, usage, and timestamp fields while tolerating unrelated upstream additions. [Price catalog parsing](../scripts/lib/prices.mjs) rejects malformed, blank, nonfinite, and empty price data before [refresh](../scripts/refresh-prices.mjs) replaces the table atomically.

Verification: [cache](../src/collect/cache.test.ts), [pricing](../src/collect/pricing.test.ts), [Eve JSON](../src/adapters/eve-json.test.ts), and [price refresh](../test/prices-refresh.test.ts) tests. Explicit malformed configuration fails; unavailable optional pricing remains an unavailable fallback. Zod 4.4.3 is a production dependency for published runtime imports.

### 6. Shared report facts — implemented

[report/facts.ts](../src/report/facts.ts) produces complete-coverage pass counts, tool-call statistics, eval coverage/score detail, p-values, and budget explanations. [Markdown](../src/report/markdown.ts) and [terminal](../src/report/terminal.ts) use these facts; escaping and layout remain specific to the output format.

Verification: the partial-coverage regression in [Markdown tests](../test/markdown.test.ts) prevents a passing eval observed in only one run from being described as passing every run. Existing Markdown snapshots and [terminal tests](../test/terminal.test.ts) protect presentation behavior.

### 7. Analysis responsibilities — implemented

[computeDelta](../src/analyze/delta.ts) assembles named modules for [statistics](../src/analyze/statistics.ts), [eval outcomes](../src/analyze/evals.ts), [behavioral drift](../src/analyze/drift.ts), [performance](../src/analyze/performance.ts), [verdicts](../src/analyze/verdict.ts), and [enforcement](../src/analyze/policy.ts). Skill and subagent occurrence comparisons share a narrow primitive rather than a general scoring framework.

Verification: [delta tests](../test/delta.test.ts) retain eval, score, trajectory, fingerprint, skill/subagent, validity, and enforcement scenarios. Inconclusive observations remain inconclusive rather than being promoted to confirmed statistical findings.

### 8. Numeric and sequence helpers — implemented

[numeric.ts](../src/numeric.ts) centralizes median/metric primitives and sequence equality for analysis, estimation, and report summaries. Statistical tail conventions and Holm adjustment remain explicit in [statistics.ts](../src/analyze/statistics.ts).

Verification: [known-answer statistics and helper tests](../test/statistics.test.ts) cover Fisher tails, Holm ordering/monotonicity, empty samples, sequence equality, and nonmutation. No statistics dependency was added solely to replace small primitives.

## Collection, CLI, and process boundaries

### 9. Process execution and Eve normalization — implemented; Execa migration deferred

[execution.ts](../src/execution.ts) owns subprocess output limits, timeout, interruption, and descendant termination. Worktree/install code no longer imports process infrastructure from the Eve adapter. Eve-specific [JSON validation](../src/adapters/eve-json.ts), [normalization](../src/adapters/eve-normalize.ts), and [usage attribution](../src/adapters/eve-usage.ts) are separate; per-eval identity reconciles modern and legacy usage in either event order.

Verification: [adapter/process tests](../src/adapters/eve.test.ts) retain meaningful nonzero exits, timeout, output bounds, cancellation, and usage attribution. [JSON tests](../src/adapters/eve-json.test.ts) reject invalid scores/collection shapes and reversed timestamp spans. Execa was not substituted without proving the same process-group and Eve-exit semantics.

### 10. Preparation and probe reuse — implemented

[prepareApp/appCacheKey](../src/harness/preparation.ts) share checkout identity, app resolution, adapter probing, agent metadata, cache inputs, and failed-preparation cleanup. `probe.agentInfo` is reused when supplied; compatible adapters without that field retain the metadata fallback. Base/head evidence remains distinct.

Verification: [validity/preparation tests](../src/harness/validity.test.ts) assert single metadata use and cleanup behavior; [runner](../src/harness/runner.test.ts) and [estimate tests](../src/harness/estimate.test.ts) exercise the shared preparation path.

### 11. Estimate cache assumptions — implemented

[Estimate options/results](../src/harness/estimate.ts) distinguish cached measurement evidence from planned comparison reuse. `cache: true` enables projected base-run reuse; false/omitted matches the normal run default. `plannedCacheReuse` and the [estimate reporter](../src/report/estimate.ts) expose the assumption.

Verification: [estimate tests](../src/harness/estimate.test.ts) compare cached evidence with planned reuse enabled and disabled, including unavailable/zero costs.

### 12. Grouped execution dependencies — implemented compatibly

[HarnessDependencies](../src/harness/dependencies.ts) groups adapters, worktrees, metadata/ref helpers, cache I/O, and validity inspection. Runner, estimator, CLI, and test helpers resolve this one dependency object. Existing top-level injected seams remain supported during the documented preview-API transition.

Verification: [public API tests](../test/runner-api.test.ts), [CLI tests](../src/cli.test.ts), and [typed harness fixtures](../test/helpers/harness.ts). See [library API documentation](library-api.md) for the supported compatibility surface.

### 13. CLI options and stable errors — implemented

[CLI](../src/cli.ts) reuses shared option registration/normalization and [parsers](../src/options.ts). [ConfigurationError, RefError, and CommandTimeoutError](../src/errors.ts) provide stable failure categories; installation handling no longer classifies timeout by searching prose. [Estimate rendering](../src/report/estimate.ts) is outside command orchestration.

Verification: [CLI tests](../src/cli.test.ts), [runner API tests](../test/runner-api.test.ts), and installation/process tests cover invalid configuration and operational failure behavior. [CLI contract documentation](cli-contract.md) records the interface.

### 14. Cleanup diagnostics — implemented

[cleanupResources](../src/harness/cleanup.ts) attempts every owned cleanup, preserves the primary operation failure, and reports secondary errors even without a progress callback. A throwing observer cannot prevent remaining cleanup. [Worktree cleanup](../src/harness/worktree.ts) removes fallback directories before pruning stale Git metadata; installation-home cleanup uses the same diagnostic boundary.

Verification: [cleanup tests](../src/harness/cleanup.test.ts) cover observer failures; [validity/harness tests](../src/harness/validity.test.ts) cover successful work with failed cleanup and eval failure plus cleanup failure. [Worktree tests](../src/harness/worktree.test.ts) retain real Git lifecycle coverage.

### 15. Installation planning — implemented

[install.ts](../src/harness/install.ts) owns the pure `planInstallation` lockfile/package-manager command policy, workspace ownership, credential scrubbing, isolated-home setup, and execution. [paths.ts](../src/harness/paths.ts) owns path containment; [worktree.ts](../src/harness/worktree.ts) owns checkout lifecycle.

Verification: [worktree/install tests](../src/harness/worktree.test.ts) cover npm, pnpm, Yarn Classic/Berry, Bun, scripts-off/on, workspace membership, lockfile refusal, symlink escape, and environment isolation. Existing `yaml` and `minimatch` remain appropriate; no Git/package-manager framework was added.

### 16. Node support contract — implemented; local minimum-version install passed

[package.json](../package.json) uses Commander 14 rather than Commander 15, retaining the advertised Node 20 floor. [CI](../.github/workflows/ci.yml) now performs an isolated Node 20 consumer install with `--engine-strict` before its CLI smoke check, instead of merely executing a package previously installed under Node 24.

Verification: the orchestrator installed the packed artifact in an isolated consumer under actual Node 20.20.2 with `npm --engine-strict --ignore-scripts`, then ran CLI `--help` successfully. The hosted Node 20 job will repeat this against the submitted commit.

## Reports and automation

### 17. Unicode terminal columns — implemented

[terminal-layout.ts](../src/report/terminal-layout.ts) uses `string-width` for visible columns and `Intl.Segmenter` for grapheme-safe splitting/padding. Existing sanitization still runs before terminal layout.

Verification: [terminal tests](../test/terminal.test.ts) cover wide/CJK characters, combining marks, emoji, long tokens, and column bounds. `string-width` 7 is a production dependency compatible with the supported Node floor.

### 18. Public report types — implemented

[PublicReport](../src/report/json.ts) is an explicit projection with branded public fingerprint labels, constructed only by `toPublicReport`. Raw analysis reports cannot satisfy the publication type accidentally. Human renderers can still consume the projection, and equal-frequency relabeling retains its privacy/equality contract.

Verification: [JSON tests](../test/json.test.ts) retain redaction/equality behavior; the [packed consumer fixture](../test/fixtures/library-consumer/consumer.mts) includes compile-time rejection of raw reports where public reports are required. Final packed-package execution is an integration responsibility.

### 19. Stable serialization — implemented without changing hash semantics

[serialization.ts](../src/serialization.ts) shares sorted object-entry handling while keeping fingerprint serialization separate from pretty JSON projection. Lexical numeric-looking keys, undefined properties, sparse-array behavior, and standard JSON presentation ordering intentionally retain their existing semantics.

Verification: [serialization compatibility cases](../test/statistics.test.ts) and [JSON determinism tests](../test/json.test.ts). No stable-stringify package was added: the two consumers have different compatibility requirements that a blind replacement would obscure.

### 20. Typed Action policy — implemented

[Action policy](../scripts/action-policy.ts) and its [executable entrypoint](../scripts/action-policy-entry.ts) own preflight and enforcement, reusing shared CLI parsers, enforcement categories, and the public schema version. [Build wiring](../scripts/build-action.mjs) produces the policy bundle; [Action YAML](../action/action.yml) wires steps and retains report publication before enforcement.

Verification: [Action tests](../test/action-upsert.test.ts) cover executable policy behavior, malformed reports/options, execution failures, and comment ordering. Final regenerated `action/dist` parity remains part of the orchestrator's integration checks.

### 21. GitHub transport — implemented with deliberate application boundaries; Octokit migration deferred

[Agent transport](../agent/lib/github/transport.ts) centralizes repository API and metadata requests with a 30-second deadline across response reading, bounded GET-only retries, Retry-After handling, and redirect refusal. The [Action transport](../action/github-request.mjs) is reused by the comment helper and [review-validation script](../scripts/validate-reviewed-pr.mjs); its retry policy permits repeatable reads/comment updates but never blindly replays POST creation. Existing pagination-origin checks and duplicate-comment recovery remain in their operation-specific code.

The installed GitHub SDK exports `createOctokit(token)`, but its factory forces a newer API version and default retry hooks without the constructor controls needed here. Replacing trusted publication transport through that factory would change behavior beyond this refactor. Agent and Action retain separate small wrappers because the standalone Action cannot depend on the agent runtime/credential graph; this duplication is intentional and tested.

Verification: [agent transport tests](../test/agent-runtime.test.ts), [Action request tests](../test/github-request.test.ts), [comment tests](../test/action-upsert.test.ts), and [review-validation tests](../test/reviewed-pr.test.ts). Tests exercise cancellation, applied deadlines, retry budgets, long Retry-After refusal, malformed JSON, and ambiguous POST handling.

## Agent and eval boundaries

### 22. Publication memory bounds — implemented

[Publication](../agent/lib/github/runtime-push.ts) reads immutable `ls-tree -l` object sizes before file content, rejects per-file/remaining-total overflow before allocation, and collects files sequentially. The pinned sandbox's streaming API fills a buffer bounded by the inspected size and cancels if mutable working-tree bytes exceed it. Byte count and Git blob SHA must still match before API publication.

Verification: [publication tests](../test/agent-publishing.test.ts) reject an oversized object before reading, stop before a seventh 4 MiB file breaches the 24 MiB budget, cancel grown streams, and reject same-size changed bytes before any blob POST. Existing immutable-SHA and exact-publication-retry cases remain.

### 23. Checkout and attestation mechanics — implemented

[checkoutOwnedBranch](../agent/lib/github/checkout.ts) shares ownership validation, brokered fetch, checked SHA resolution, and denied-network restoration. Separate implementer/reviewer tool entrypoints preserve Eve filesystem identities. Only implementer revision checkout updates its baseline marker. [attestReviewedCommit](../agent/lib/github/attest.ts) reuses [reviewedSha](../agent/lib/github/review-checks.ts), requires durable check evidence, verifies the remote SHA, rechecks the clean checkout, and persists the attestation.

Verification: [agent publishing tests](../test/agent-publishing.test.ts) reject invalid/failed `rev-parse`, restore deny-all, reject foreign sessions, and deny stale or incomplete review evidence. Reviewer and implementer model assignments were not changed.

### 24. Executable verification policy — implemented

[verification.ts](../agent/lib/verification.ts) defines named commands, base check IDs, behavior-comparison patterns, and the CI-only station runtime proof. Reviewer checks consume this plan, expanding integration into five separate `HOSTED_INTEGRATION_SCENARIOS` while retaining the 240-second per-step deadline; CI still runs the complete integration suite. Station prompts refer to it rather than maintaining alternate `--fail-on` policies. The reviewer plan includes packed-package validation and checks all Action bundle outputs. [Deterministic comparison routing](../.github/workflows/diff0-free.yml) covers the same behavior scope.

Intentional difference: the local Eve/just-bash runtime proof runs in CI; hosted stations cannot run pruned local backends. Real-model/mutating evals remain opt-in and are not introduced into ordinary CI.

Verification: [workflow contract tests](../test/workflow-routing.test.ts) compare routing/check policy and require every integration test file to appear in the bounded hosted scenario map; [agent runtime tests](../test/agent-runtime.test.ts) protect sequential durable check progress, stale-SHA invalidation, failures, and timeouts. The orchestrator subsequently ran the local station runtime proof successfully.

### 25. Write-capability inventory — implemented

[capabilities.ts](../agent/lib/github/capabilities.ts) defines mounted tools once and derives their write classification from the installed SDK's authoritative inventory. The GitHub extension uses that mount list; [eval helpers](../evals/helpers.ts) add root writes. Smoke, prompt-injection, and read-only scenarios use the same complete union.

Verification: [security tests](../test/agent-security.test.ts) require exact parity between mounted SDK-classified writes and explicit approval policies, and include `update_factory_brain`. Authorization still belongs to the original trust/approval modules, not the eval inventory.

### 26. Artifact/review result shapes — implemented

[Artifact tools](../agent/lib/artifacts/tools.ts), checkout, review checking, and attestation use explicit success/failure or found/missing/unavailable result variants with required corresponding data. Invalid/cross-session artifact IDs remain nondisclosing missing results; operational read failures return unavailable. [Blob writes](../agent/lib/blob.ts) accept an explicit content type, used as JSON for intake latches and review attestations.

Verification: pinned Eve 0.47.5 typechecking/discovery accepts the output unions. [Artifact/pipeline tests](../test/agent-publishing.test.ts) check successful content, cross-scope and invalid IDs, unavailable storage, and JSON attestation metadata. This is a targeted migration of the reviewed boundaries, not a redesign of every tool's public output contract.

### 27. Deterministic failure/drift coverage — implemented

[CLI integration](../src/collect/cli.integration.test.ts) uses the existing demo agent's deterministic skill-removal change and asserts the actual behavioral-drift category, report evidence, and requested failure exit while eval outcomes remain passing. [Adapter integration](../src/collect/adapter.integration.test.ts) retains real collection coverage. The mocked agent pipeline test walks publication → independent durable checks → attestation → draft authorization, then rejects a moved remote SHA and non-draft autonomous publication.

Verification: the adapter/unchanged-cache integration cases and corrected deterministic drift case were run by the harness subtask; [agent publishing tests](../test/agent-publishing.test.ts) exercise durable state without external writes. No paid/mutating pipeline eval was used as a substitute for deterministic assertions.

## Tooling, website, and cleanup

### 28. Authored-code check coverage — implemented with explicit limits

[Biome](../biome.json) includes root tests, scripts, Action helpers, and website TypeScript/JavaScript while excluding generated/vendor content. [Test TypeScript configuration](../tsconfig.tests.json) adds root TypeScript tests/helpers and authored TypeScript scripts to the [typecheck command](../package.json). The website has its own typecheck/build/test steps in [CI](../.github/workflows/ci.yml).

Limit: this does not claim semantic TypeScript checking for every `.mjs` file; `checkJs` remains false. JavaScript scripts receive lint and targeted executable tests. Generated fixtures remain intentionally outside the broad lint/typecheck sweep.

Verification: expanded coverage is executable in the new commands. The orchestrator’s integrated lint/typecheck run passed; hosted checks will repeat them against the submitted commit.

### 29. Typed reusable fixtures — implemented in the reviewed seams

[Harness fixtures](../test/helpers/harness.ts) and [demo repository fixtures](../test/helpers/demo-repository.ts) share adapters, dependency objects, records, and scratch Git setup across runner/estimate/spend/integration tests. Agent code exposes narrow publication/review/checkout/authorization/role-lookup ports; the three agent test files no longer use `as never`. Integration cleanup restores the previous environment value.

Verification: focused harness and agent suites exercise the shared fixtures, and agent typechecking validates their interface shape. Real Git integration tests remain; scenario-specific setup has not been replaced with a universal mocking framework.

### 30. Structured website evidence — implemented

[Showcase JSON](../website/content/showcase.json) stores metric IDs, numeric medians/ranges, numeric reported percentage changes, eval counts, scope identities, and explicit provenance. The Zod-backed [content model](../website/lib/showcase-model.ts) validates and formats both [web content](../website/lib/showcase.ts) and [OG generation](../website/scripts/gen-og.mjs). Passing coverage, observation totals, PR number, scope, headline/verdict claims, OG metadata, summaries, and captured date/version are derived centrally. Accepted regression and unchanged snapshots are tested, and a green snapshot cannot contain confirmed regression/drift.

Historical precision is deliberate: the captured report's duration change remains −41%; it is not recomputed from already-rounded displayed medians 20.2s and 11.8s. The PR #15 source comment and 2026-09-04 snapshot remain explicit.

Verification: [website content tests](../website/test/content.test.mjs) preserve exact displayed/OG evidence and reject malformed/partial data. Regenerating OG and Apple icon produced byte-for-byte unchanged assets. Website production build and typecheck passed at subtask handoff.

### 31. Copy feedback and website ownership — implemented

[Clipboard helper](../website/lib/clipboard.ts) checks the fallback's boolean result and removes its temporary field in `finally`. [CopyButton](../website/components/CopyButton.tsx) reports failure accurately, clears its timer, and ignores late/superseded requests after unmount. [Home](../website/app/page.tsx) composes real [section components](../website/components/home/); shared primitives remain small. Repeated terminal/panel colors live in [CSS tokens](../website/app/globals.css), and PR summary rows have stable semantic keys.

Verification: [clipboard tests](../website/test/clipboard.test.mjs) cover native success, fallback success, false results, exceptions, and cleanup. Website lint/build/typecheck passed. The orchestrator also verified desktop and 390px browser layouts without overflow/console errors and exercised command/workflow copy success feedback. The pure tests cover fallback failure paths; they do not claim a mounted React unmount test. No clipboard/theme/UI framework was added.

### 32. Current-code isolated demos — implemented

[mock-demo.sh](../demo/mock-demo.sh) builds current source and uses a unique scratch checkout with exit cleanup. [setup.sh](../demo/setup.sh) also uses a unique checkout, retaining it explicitly for recording and printing its location/recording command. Both use [fixture.sh](../demo/fixture.sh) to exclude dependency/runtime/Git state while copying. The [recording tape](../demo/demo.tape) accepts the selected demo checkout.

Verification: shell syntax checks passed in the harness subtask. The deterministic skill-removal behavior is independently covered by the CLI integration test. The paid real-model recording setup was not run as routine validation.

### 33. Stale comments and names — targeted cleanup implemented

The [normalized type header](../src/types.ts) describes the host-independent model; [branch documentation](../agent/lib/github/git-remote.ts) separates name safety from publication policy; artifact UUID and [default-branch discovery comments](../agent/lib/github/repo-sandbox.ts) match implementation. Integration filenames describe adapter/CLI behavior rather than milestones. Tool wrappers were shortened around shared checked operations while trust, byte-identity, and statistical explanations were retained.

Verification: source review, typechecking/lint, agent discovery, and renamed integration execution. This is targeted correction of misleading material, not wholesale comment removal or stylistic rewriting.

## Library decisions and remaining validation

- **Adopted:** Zod 4.4.3 for external-data and website snapshot schemas; `string-width` 7 for terminal display columns; Commander 14 to honor Node 20 support.
- **Retained:** Commander, YAML, minimatch, markdown-table, existing Eve/GitHub SDK integrations, and the app-owned trust/publishing policy.
- **Deferred intentionally:** Execa and a broad Octokit transport replacement until their lifecycle/retry/API-version behavior has a demonstrated compatibility advantage. The maintainability fixes were implemented without making those speculative migrations prerequisites.
- **Not added:** p-limit (sequential bounded publication suffices), a statistics/serialization package, a Git wrapper, clipboard/theme framework, CMS, or DOM test framework solely for these changes.

Focused validation reported by implementation subtasks at handoff:

| Scope | Completed evidence |
| --- | --- |
| Analysis/reporting | 163 tests across 9 focused files; build/type compilation and 36 owned Biome paths passed. |
| Harness/adapter | 160 tests across 13 focused files; 11 final Eve JSON cases; typecheck passed. Adapter and unchanged/cache integration cases passed; the corrected drift-only integration rerun passed. Shell syntax passed. |
| Agent/evals | 99 tests across the three agent suites; agent typecheck and Biome passed; Eve 0.47.5 discovery reported zero errors/warnings; eval listing passed. |
| Website | 8 Node tests; production static build, typecheck, and website Biome passed; generated OG/Apple icon unchanged. |

The subtask counts above are not additive. The orchestrator subsequently reported these integrated local results:

| Final local check | Result |
| --- | --- |
| Root unit suite | 591 passed; 1 existing skipped test; 32 files. |
| Root typecheck and lint | Passed; Biome checked 221 files. |
| Isolated packed-package consumer | Passed. |
| Local minimum-version consumer | Actual Node 20.20.2 engine-strict install and CLI help passed. |
| Full integration suite | 7 tests across 3 files passed in 317.73s, including calibration, cache reuse, and deterministic skill drift. The same scenarios were then split into 5 files for bounded hosted steps; reruns of those independently invoked files are tracked separately. |
| Agent validation/discovery | 99 tests passed; zero discovery diagnostics. |
| Local station runtime proof | Passed using deterministic mock execution. |
| Browser verification | Desktop and 390px layouts had no overflow/console errors; command and workflow copy feedback worked. |
| Latest website follow-up | 8 tests passed; production build passed after dynamic evidence-claim fixes. |
| Hosted-step policy follow-up | Agent 99 tests/typecheck passed; workflow contract 45 tests passed, including exact scenario coverage. |

Hosted PR checks (including the Node 20 engine-strict consumer job) and final generated-bundle parity against the submitted commit remain pending at this document’s preparation. No PR merge or deployment is implied.
