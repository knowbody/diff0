import { showcase } from "@/lib/showcase";
import { GITHUB } from "./links";
import { Arrow, ResultRow } from "./shared";

export default function Hero() {
  return (
    <section className="hero-grid relative overflow-hidden border-b border-line">
      <div className="mx-auto max-w-[1240px] px-5 pt-20 pb-14 text-center sm:px-8 sm:pt-28 lg:pt-36">
        <a
          href={showcase.pullRequestUrl}
          className="group mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-muted shadow-sm transition-colors hover:text-fg"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-accent uppercase">
            v{showcase.releaseVersion}
          </span>
          See the captured real-model run
          <span className="transition-transform group-hover:translate-x-0.5">
            <Arrow />
          </span>
        </a>

        <h1 className="mx-auto max-w-[970px] text-[clamp(3.25rem,7.8vw,7rem)] leading-[0.92] font-medium tracking-[-0.065em] text-balance">
          Review the agent,
          <br />
          <span className="font-editorial font-normal tracking-[-0.045em] italic">
            not just the diff.
          </span>
        </h1>
        <p className="mx-auto mt-8 max-w-[660px] text-lg leading-8 text-muted text-balance sm:text-xl">
          diff0 compares how your Eve agent behaves across two committed refs—so captured behavioral
          changes can show up before you merge them.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={showcase.pullRequestUrl}
            className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            Open the showcase PR <Arrow diagonal />
          </a>
          <a
            href={GITHUB}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-5 text-sm font-medium transition-colors hover:bg-codebg sm:w-auto"
          >
            View the source <Arrow diagonal />
          </a>
        </div>

        <div className="relative mx-auto mt-20 max-w-[1050px] text-left sm:mt-24">
          <div className="hero-glow" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[18px] border border-black/15 bg-terminal shadow-[0_40px_100px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                </span>
                <span className="font-mono text-[11px] text-white/60">
                  diff0 / {showcase.head.ref}
                </span>
              </div>
              <span className="hidden items-center gap-2 font-mono text-[10px] tracking-wider text-white/60 uppercase sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-panel-success" /> comparison complete
              </span>
            </div>
            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-white/10 p-5 sm:p-8 lg:border-r lg:border-b-0">
                <p className="mb-7 font-mono text-[10px] tracking-[0.16em] text-white/60 uppercase">
                  source change
                </p>
                <div className="font-mono text-xs leading-7 text-white/60 sm:text-[13px]">
                  <p className="text-white/60">agent/instructions.md</p>
                  <p className="mt-3 rounded bg-diff-negative/10 px-2 text-diff-negative-text">
                    − After computing a figure, delegate a one-line executive summary to the
                  </p>
                  <p className="rounded bg-diff-negative/10 px-2 text-diff-negative-text">
                    − `reporter` subagent before replying.
                  </p>
                  <p className="mt-1 rounded bg-panel-success/10 px-2 text-diff-positive-text">
                    + After computing a figure, give a one-line executive summary before replying.
                  </p>
                </div>
                <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Eval observations</span>
                    <span className="inline-flex items-center gap-1.5 text-panel-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {showcase.evalObservationTotal.passed} / {showcase.evalObservationTotal.total}{" "}
                      passed
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-5 sm:p-8">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] tracking-[0.16em] text-white/60 uppercase">
                      behavioral comparison
                    </p>
                    <p className="mt-2 text-lg font-medium text-white">
                      {showcase.comparisonTitle}
                    </p>
                  </div>
                  <span
                    data-verdict={showcase.verdict}
                    className="verdict-badge rounded-full border px-2.5 py-1 font-mono text-[10px]"
                  >
                    {showcase.verdictBadge}
                  </span>
                </div>
                <ResultRow
                  label={`${showcase.subagent.name} subagent`}
                  from={showcase.subagent.base}
                  to={showcase.subagent.head}
                  tone="warning"
                />
                <ResultRow
                  label="eval observations"
                  from={showcase.evalPasses.base}
                  to={showcase.evalPasses.head}
                />
                <ResultRow
                  label="output tokens / run"
                  from={showcase.featuredMetrics.outputTokens.baseShort}
                  to={showcase.featuredMetrics.outputTokens.headShort}
                  tone="good"
                />
                <ResultRow
                  label="duration / run"
                  from={showcase.featuredMetrics.duration.baseShort}
                  to={showcase.featuredMetrics.duration.headShort}
                  tone="good"
                />
                <div className="mt-5 flex items-center gap-3 text-[11px] text-white/60">
                  <span>Fisher exact + Holm adjustment</span>
                  <span>·</span>
                  <span>N={showcase.runsPerRef} per ref</span>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-5 text-center font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
            One instruction simplified · {showcase.runsPerRef * 2} real-model suites · automated in
            GitHub Actions
          </p>
        </div>
      </div>
    </section>
  );
}
