/**
 * Pixel-faithful GitHub-style reproduction of the comment diff0 posts.
 * The raw counts come through lib/showcase.ts from the committed real-model
 * content/drift-report.json. The legacy suite-global tool sequence is omitted because current
 * diff0 scopes sequence/count evidence per eval and the old aggregate cannot
 * be reconstructed losslessly.
 * One presentation-only simplification: the evals table drops the
 * "· score 1 → 1 (+0)" suffix from the status cells (the pass-rate cells
 * carry the signal; inconclusive rows explain themselves via a title tooltip).
 * Colors follow the site theme via the --gh-* tokens in globals.css:
 * GitHub-dark values on the dark canvas, GitHub-light values on the light
 * canvas, matching what GitHub itself shows a user in that theme.
 */

import { showcase } from "@/lib/showcase";

const gh = {
  bg: "var(--gh-bg)",
  headerBg: "var(--gh-header)",
  border: "var(--gh-border)",
  fg: "var(--gh-fg)",
  muted: "var(--gh-muted)",
  codeBg: "var(--gh-code)",
};

function Code({ children }: { children: string }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 font-mono text-[85%]"
      style={{ backgroundColor: gh.codeBg, color: gh.fg }}
    >
      {children}
    </code>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="mt-6 mb-3 border-b pb-2 text-base font-semibold"
      style={{ borderColor: gh.border }}
    >
      {children}
    </h4>
  );
}

const cellBase = "border px-3 py-1.5 whitespace-nowrap";

function EvalRow({
  name,
  base,
  head,
  status,
  statusTitle,
}: {
  name: string;
  base: string;
  head: string;
  status: string;
  statusTitle?: string;
}) {
  return (
    <tr>
      <td className={cellBase} style={{ borderColor: gh.border }}>
        <Code>{name}</Code>
      </td>
      <td
        className={`${cellBase} text-center`}
        style={{ borderColor: gh.border }}
      >
        {base}
      </td>
      <td
        className={`${cellBase} text-center`}
        style={{ borderColor: gh.border }}
      >
        {head}
      </td>
      <td
        className={cellBase}
        style={{ borderColor: gh.border }}
        title={statusTitle}
      >
        {status}
      </td>
    </tr>
  );
}

function RunTable({
  caption,
  rows,
}: {
  caption: React.ReactNode;
  rows: [string, string, string, string, string, string][];
}) {
  return (
    <>
      <p className="mt-4 mb-2">{caption}</p>
      <div className="overflow-x-auto">
        <table
          className="w-max border-collapse text-[13px]"
          style={{ borderColor: gh.border }}
        >
          <thead>
            <tr>
              {["Run", "Evals passed", "Tool calls", "Skills loaded", "Cost", "Duration"].map(
                (h) => (
                  <th
                    key={h}
                    className={`${cellBase} font-semibold`}
                    style={{ borderColor: gh.border, backgroundColor: gh.headerBg }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((cell, i) => (
                  <td
                    // biome-ignore lint: fixed-width row tuple
                    key={i}
                    className={`${cellBase} ${i === 2 || i === 4 || i === 5 ? "text-right" : ""}`}
                    style={{ borderColor: gh.border }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PrComment() {
  return (
    <div className="flex gap-3">
      {/* avatar placeholder */}
      <div
        aria-hidden="true"
        className="mt-1 hidden h-10 w-10 shrink-0 rounded-full border sm:block"
        style={{ backgroundColor: gh.headerBg, borderColor: gh.border }}
      />
      <div className="relative min-w-0 flex-1">
        {/* caret pointing at the avatar */}
        <div
          aria-hidden="true"
          className="absolute -left-2 top-4 hidden h-4 w-4 rotate-45 border-b border-l sm:block"
          style={{ backgroundColor: gh.headerBg, borderColor: gh.border }}
        />
        <div
          className="overflow-hidden rounded-md border"
          style={{ backgroundColor: gh.bg, borderColor: gh.border, color: gh.fg }}
        >
          <div
            className="relative flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-sm"
            style={{ backgroundColor: gh.headerBg, borderColor: gh.border }}
          >
            <span className="font-semibold">github-actions</span>
            <span
              className="rounded-full border px-1.5 text-xs leading-[18px]"
              style={{ borderColor: gh.border, color: gh.muted }}
            >
              bot
            </span>
            <span style={{ color: gh.muted }}>commented</span>
          </div>

          <div className="px-4 py-4 text-sm leading-6 sm:px-5">
            <h3 className="mb-3 text-xl font-semibold">
              diff0: {showcase.base.ref}...{showcase.head.ref} {showcase.verdictIcon}
            </h3>

            <p className="mb-3 font-semibold">{showcase.verdictSummary}.</p>

            <p className="mb-1" style={{ color: gh.muted }}>
              eve {showcase.base.eveVersion} · model <Code>{showcase.base.model}</Code> ·{" "}
              {showcase.runsPerRef} runs per ref · sandbox {showcase.base.sandboxBackend}
              {showcase.base.sandboxInferred ? " (inferred)" : ""} · comparison cost{" "}
              {showcase.comparisonCost} ({showcase.costSource})
            </p>

            <H3>Evals</H3>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["Eval", "Base", "Head", "Status"].map((h) => (
                      <th
                        key={h}
                        className={`${cellBase} font-semibold`}
                        style={{
                          borderColor: gh.border,
                          backgroundColor: gh.headerBg,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {showcase.evals.map((row) => (
                    <EvalRow
                      key={row.name}
                      name={row.name}
                      base={row.base}
                      head={row.head}
                      status={row.label}
                      statusTitle={row.title}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <H3>Behavioral drift</H3>
            <p className="mb-2 font-semibold">Subagents</p>
            <ul className="list-disc pl-6">
              <li>
                <Code>{showcase.subagent.name}</Code>{" "}
                {showcase.subagent.evalName === null
                  ? "(unattributed)"
                  : `(${showcase.subagent.evalName})`}
                : used in {showcase.subagent.baseUsedRuns} of{" "}
                {showcase.subagent.baseTotalRuns} base runs → {showcase.subagent.headUsedRuns} of{" "}
                {showcase.subagent.headTotalRuns} head runs —{" "}
                <strong>{showcase.subagent.confidence}</strong> (raw Fisher p=
                {showcase.subagent.rawPValue}; Holm-adjusted p={showcase.subagent.holmPValue})
              </li>
            </ul>

            <H3>Cost &amp; performance</H3>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["Metric", "Base (median)", "Head (median)", "Δ"].map(
                      (h) => (
                        <th
                          key={h}
                          className={`${cellBase} font-semibold`}
                          style={{
                            borderColor: gh.border,
                            backgroundColor: gh.headerBg,
                          }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {showcase.metrics.map((row) => (
                    <tr key={row.label}>
                      {[row.label, row.base, row.head, row.delta].map((cell, i) => (
                        <td
                          // biome-ignore lint: fixed-width row tuple
                          key={i}
                          className={`${cellBase} ${i > 0 ? "text-right" : ""}`}
                          style={{ borderColor: gh.border }}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <H3>Changed files</H3>
            <ul className="mb-3 list-disc pl-6">
              <li>
                <Code>{showcase.changedFile.path}</Code> (+{showcase.changedFile.insertions} −
                {showcase.changedFile.deletions})
              </li>
            </ul>
            <p className="mb-4 italic" style={{ color: gh.muted }}>
              {showcase.diffSummary}. File attribution is correlational, not causal.
            </p>

            <details className="group">
              <summary
                className="cursor-pointer select-none list-none font-semibold"
                style={{ color: gh.fg }}
              >
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block transition-transform group-open:rotate-90"
                >
                  ▸
                </span>
                Per-run raw summaries
              </summary>
              <RunTable
                caption={
                  <>
                    <strong>base</strong> — <Code>{showcase.base.ref}</Code> @{" "}
                    <Code>{showcase.base.commitSha.slice(0, 7)}</Code>
                  </>
                }
                rows={showcase.runRows.base}
              />
              <RunTable
                caption={
                  <>
                    <strong>head</strong> — <Code>{showcase.head.ref}</Code> @{" "}
                    <Code>{showcase.head.commitSha.slice(0, 7)}</Code>
                  </>
                }
                rows={showcase.runRows.head}
              />
            </details>

            <hr className="my-4" style={{ borderColor: gh.border }} />
            <p className="italic" style={{ color: gh.muted }}>
              Statistical comparison across {showcase.runsPerRef} runs per ref — LLM runs are
              nondeterministic; treat proportions, not absolutes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
