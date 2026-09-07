import { showcase } from "@/lib/showcase";

const gh = {
  bg: "var(--gh-bg)",
  headerBg: "var(--gh-header)",
  border: "var(--gh-border)",
  fg: "var(--gh-fg)",
  muted: "var(--gh-muted)",
  codeBg: "var(--gh-code)",
};

const cell = "border border-gh-border px-3 py-1.5 whitespace-nowrap";

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

function Section({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mt-6 mb-3 border-b border-gh-border pb-2 text-base font-semibold">{children}</h4>
  );
}

function TableHead({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr>
        {labels.map((label) => (
          <th
            key={label}
            className={`${cell} font-semibold`}
            style={{ borderColor: gh.border, backgroundColor: gh.headerBg }}
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SummaryRow({
  label,
  base,
  head,
  change,
}: {
  label: string;
  base: string;
  head: string;
  change: string;
}) {
  return (
    <tr>
      <td className={cell}>{label}</td>
      <td className={`${cell} text-right`}>{base}</td>
      <td className={`${cell} text-right`}>{head}</td>
      <td className={`${cell} text-right`}>{change}</td>
    </tr>
  );
}

export default function PrComment() {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden="true"
        className="mt-1 hidden h-10 w-10 shrink-0 rounded-full border sm:block"
        style={{ backgroundColor: gh.headerBg, borderColor: gh.border }}
      />
      <div className="relative min-w-0 flex-1">
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
            <h3 className="mb-3 text-xl font-semibold">diff0 report {showcase.verdictIcon}</h3>
            <div
              data-verdict={showcase.verdict}
              className="verdict-callout mb-3 border-l-4 px-4 py-3"
            >
              <strong>{showcase.verdictTitle}</strong> {showcase.verdictSummary}
            </div>
            <p className="mb-1" style={{ color: gh.muted }}>
              Comparing <Code>{showcase.base.commitSha.slice(0, 7)}</Code> →{" "}
              <Code>{showcase.head.commitSha.slice(0, 7)}</Code> · {showcase.runsPerRef} runs per
              ref · model <Code>{showcase.model}</Code>
            </p>

            <Section>At a glance</Section>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-[13px]">
                <TableHead labels={["Signal", "Base", "Head", "Change"]} />
                <tbody>
                  <SummaryRow
                    label="Evals passing every run"
                    base={showcase.evalsPassingEveryRun.base}
                    head={showcase.evalsPassingEveryRun.head}
                    change={showcase.evalsPassingEveryRun.change}
                  />
                  {showcase.metrics.map((metric) => (
                    <SummaryRow
                      key={metric.id}
                      label={metric.label}
                      base={metric.base}
                      head={metric.head}
                      change={metric.delta}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Section>Observed behavioral differences</Section>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-[13px]">
                <TableHead labels={["Signal", "Base", "Head", "Scope"]} />
                <tbody>
                  <tr>
                    <td className={cell}>
                      Subagent <Code>{showcase.subagent.name}</Code>
                    </td>
                    <td className={cell}>
                      {showcase.subagent.baseUsedRuns}/{showcase.subagent.baseTotalRuns} runs
                    </td>
                    <td className={cell}>
                      {showcase.subagent.headUsedRuns}/{showcase.subagent.headTotalRuns} runs
                    </td>
                    <td className={cell}>
                      {showcase.subagent.scope} · {showcase.subagent.confidence}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 italic" style={{ color: gh.muted }}>
              {showcase.inconclusiveNote}
            </p>

            <Section>Eval results</Section>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-[13px]">
                <TableHead labels={["Eval", "Base", "Head", "Result"]} />
                <tbody>
                  {showcase.evals.map((row) => (
                    <tr key={row.name}>
                      <td className={cell}>
                        <Code>{row.name}</Code>
                      </td>
                      <td className={`${cell} text-center`}>{row.base}</td>
                      <td className={`${cell} text-center`}>{row.head}</td>
                      <td className={cell}>{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details className="group mt-5">
              <summary className="cursor-pointer select-none list-none font-semibold">
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block transition-transform group-open:rotate-90"
                >
                  ▸
                </span>
                Full comparison details
              </summary>
              <p className="mt-4" style={{ color: gh.muted }}>
                eve {showcase.eveVersion} · actual sandbox {showcase.sandbox} · host default
                candidate {showcase.hostDefaultSandboxCandidate} · comparison cost unavailable
              </p>
              <p className="mt-3">
                <strong>Subagent evidence:</strong> Fisher raw p={showcase.subagent.rawPValue}; Holm
                p={showcase.subagent.holmPValue} in each of {showcase.subagent.scope}.
              </p>
              <p className="mt-3">
                <strong>Cost note:</strong> {showcase.costNote}
              </p>
              <p className="mt-3">
                <strong>Changed file:</strong> <Code>{showcase.changedFile.path}</Code> (+
                {showcase.changedFile.insertions} −{showcase.changedFile.deletions})
              </p>
              <p className="mt-3 italic" style={{ color: gh.muted }}>
                {showcase.diffSummary}. File attribution is correlational, not causal.
              </p>
            </details>

            <hr className="my-4 border-gh-border" />
            <p className="italic" style={{ color: gh.muted }}>
              {showcase.snapshotLabel}. Statistical comparison across {showcase.runsPerRef} runs per
              ref — LLM runs are nondeterministic; treat proportions, not absolutes.{" "}
              <a className="not-italic underline" href={showcase.sourceUrl}>
                View the source GitHub report.
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
