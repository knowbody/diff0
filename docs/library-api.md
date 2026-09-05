# Library API

Install `@knowbody/diff0` as a dependency. The library is ESM and requires Node.js
20 or newer; executing an Eve app also requires the Node version supported by that app.

The CLI uses the same `compareRefs` function offered to library consumers. Library
calls return values or reject with errors; callers own report destinations, logging,
and process exit codes. Importing an entrypoint does not start evals or execute the CLI.

## Compare Git refs

```ts
import { violatesEnforcement } from "@knowbody/diff0";
import { compareRefs } from "@knowbody/diff0/runner";
import { toPublicReport } from "@knowbody/diff0/reporters";

const report = await compareRefs({
  repoPath: process.cwd(),
  appDir: ".",
  baseRef: "main",
  headRef: "HEAD",
  runs: 3,
  evalFilter: [],
  onProgress: (message) => console.error(message),
  performanceThresholds: { durationMs: 50 },
});

const shouldBlock = violatesEnforcement(report, ["eval-regression"]);
const payload = toPublicReport(report);
// Send payload to your own UI or report destination. Decide how to use shouldBlock.
```

`compareRefs` creates and cleans up temporary worktrees, installs each ref's locked
dependencies, runs each ref's Eve CLI, applies bundled fallback pricing, and returns
the comparison. Cache reuse defaults to off; set `noCache: false` to opt in. The
lower-level `runComparison` collects records without producing a report; its existing
cache default is on, so pass `noCache: true` for a fresh collection. `runEstimate`
projects a comparison using a sample or cached results.

These execution functions run repository code. The same trust requirements as the
CLI apply: both refs must be trusted with the eval credentials. Dependency lifecycle
scripts default to disabled. `maxSpendUsd` is checked after suite completion and
cannot enforce a budget when cost is unavailable. Progress and spend callbacks must
not throw unless the caller intends to abort the operation.

Errors such as `EvalRunError`, `MaxSpendExceededError`, `NoEvalsError`,
`EvalFilterNoMatchError`, and `CommandInterruptedError` are exported from `/runner`.
Other failures may be ordinary `Error` instances. No library function sets an exit
code. Execution currently uses process signal handling; concurrent comparisons in
one process are not a documented isolation guarantee.

## Compare records collected by your host

```ts
import { computeDelta, type RunRecord } from "@knowbody/diff0";
import { renderMarkdown } from "@knowbody/diff0/reporters";

export function compareCollected(base: RunRecord[], head: RunRecord[]) {
  const report = computeDelta(base, head, {
    sandboxInferred: false,
    now: "2026-09-05T00:00:00.000Z",
    validityMismatches: [],
    performanceThresholds: { tokensOut: 50 },
  });
  return renderMarkdown(report);
}
```

The root entrypoint contains the pure comparison engine and types. It does not
import Git execution, Eve invocation, pricing files, or renderers. Both arrays must
contain at least one record. Supply normalized `RunRecord` values, including explicit
unknown cost (`null`), runtime identities, and eval attribution. Types describe the
input contract; arbitrary JSON is not runtime-validated by this API.

`computeDelta` does not collect evidence or apply price estimates. The caller is
responsible for consistent token units, cost provenance (`costSource` when using
estimated costs), and evaluator/configuration validity warnings. Supply
`sandboxInferred` explicitly: the existing low-level default is `true`. A fixed `now`
makes output deterministic. Enforcement is separate from analysis through
`violatesEnforcement`, and performance budgets are configurable.

Hosts with Eve JSON can use `summaryToRunRecord` and `SummaryContext` from
`@knowbody/diff0/eve`. `EveCliAdapter` is also exported. This adapter remains tied to
the tested Eve versions in the main README; these exports do not broaden compatibility.
An alternative collector can implement `EveAdapter` and supply it as `adapter` to
the runner. Other dependency-injection fields in runner option types are advanced
testing seams, not required configuration for ordinary consumers.

## Present results

`@knowbody/diff0/reporters` exports `renderTerminal`, `renderMarkdown`, `renderJson`,
and `toPublicReport`. Renderers return strings without writing files or logging.
`toPublicReport` returns a structured copy with `schemaVersion` matching the CLI JSON
contract. It replaces reusable input/output fingerprints with opaque labels without
mutating the internal report. Use it when building your own UI or serializing reports.

Internal `DeltaReport` objects retain fingerprints and must not be published directly.
The public conversion does not remove all identifying information: eval/tool names,
refs, paths, and metadata remain. Public reports are presentation artifacts, not inputs
for reconstructing `RunRecord` evidence or running another comparison.

Only the four package entrypoints are supported imports. Deep imports into `dist/`
remain private. The library is currently 0.x; consumers should pin a compatible
version and review release notes when upgrading.
