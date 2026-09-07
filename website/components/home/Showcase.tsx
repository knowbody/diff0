import { showcase } from "@/lib/showcase";
import { Arrow, Eyebrow } from "./shared";

export default function Showcase() {
  return (
    <section id="demo" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div>
          <Eyebrow>Live proof, not a mock</Eyebrow>
          <h2 className="max-w-[720px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">
            Inspect the run, the checks, and the source diff.
          </h2>
        </div>
        <p className="max-w-[430px] text-sm leading-6 text-muted">
          GitHub Actions called {showcase.modelDisplay} for {showcase.runsPerRef} runs per ref. The
          captured PR ties each headline result to the workflow, source diff, and bot-authored
          report.
        </p>
      </div>
      <div className="grid overflow-hidden rounded-[20px] border border-line bg-card shadow-[0_28px_90px_rgba(0,0,0,0.1)] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="p-7 sm:p-10 lg:border-r lg:border-line">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
            Source-linked evidence
          </p>
          <h3 className="mt-5 max-w-[580px] text-3xl font-medium tracking-[-0.04em]">
            One public PR. Real model calls. Inspectable provenance.
          </h3>
          <p className="mt-5 max-w-[610px] leading-7 text-muted">
            {showcase.sourceSummary} {showcase.verdictExplanation}
          </p>
          <a
            href={showcase.pullRequestUrl}
            className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg"
          >
            Open PR #{showcase.pullRequestNumber} <Arrow diagonal />
          </a>
        </div>
        <div className="divide-y divide-line">
          {[
            ["Model", showcase.model],
            ["Runs", `${showcase.runsPerRef} per ref`],
            [
              "Output tokens",
              `median ${showcase.featuredMetrics.outputTokens.delta.replace("-", "−")}`,
            ],
            ["Duration", `median ${showcase.featuredMetrics.duration.delta.replace("-", "−")}`],
            ["Cost", "unavailable; no savings claim"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-5 px-7 py-5 text-sm">
              <span className="text-muted">{label}</span>
              <span className="text-right font-mono text-xs">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
