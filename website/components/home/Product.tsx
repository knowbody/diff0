import { showcase } from "@/lib/showcase";
import { Eyebrow } from "./shared";

export default function Product() {
  return (
    <section id="product" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[820px] text-center">
        <Eyebrow centered>The gap after evals</Eyebrow>
        <h2 className="text-[clamp(2.5rem,5vw,4.75rem)] leading-[1] font-medium tracking-[-0.055em] text-balance">
          Your eval passed.
          <br />
          Your agent still changed.
        </h2>
        <p className="mx-auto mt-7 max-w-[640px] text-lg leading-8 text-muted">
          A scorer tells you whether the answer was acceptable. diff0 shows captured evidence about
          how the agent got there—and whether that behavior moved with your code.
        </p>
      </div>

      <div className="mt-16 grid overflow-hidden rounded-2xl border border-line bg-line shadow-[0_24px_80px_rgba(0,0,0,0.06)] gap-px lg:grid-cols-3 lg:gap-x-px lg:gap-y-0">
        <article className="min-w-0 bg-card p-7 sm:p-9 lg:row-span-4 lg:grid lg:grid-rows-subgrid">
          <span className="font-mono text-[11px] text-muted">01</span>
          <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">A tiny edit</h3>
          <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">
            A process requirement becomes a direct-output requirement.
          </p>
          <div className="mt-8 min-h-28 rounded-xl border border-line bg-codebg p-4 font-mono text-[11px] leading-6">
            <p className="text-muted">instructions.md</p>
            <p className="mt-2 -mx-1 rounded bg-red-500/10 px-1 text-negative">
              − Delegate summary to reporter
            </p>
            <p className="-mx-1 rounded bg-green-500/10 px-1 text-positive">
              + Give a one-line summary
            </p>
          </div>
        </article>
        <article className="min-w-0 bg-card p-7 sm:p-9 lg:row-span-4 lg:grid lg:grid-rows-subgrid">
          <span className="font-mono text-[11px] text-muted">02</span>
          <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">{showcase.evalTitle}</h3>
          <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">
            {showcase.headEvalSummary} Repetition can reveal what one green run misses.
          </p>
          <div className="mt-8 min-h-28 rounded-xl border border-line bg-codebg p-4 font-mono text-[11px] leading-6">
            {showcase.evals.map((evaluation) => (
              <p key={evaluation.name} className="flex items-center justify-between gap-3">
                <span className="truncate text-muted">{evaluation.name.split("/").at(-1)}</span>
                <span className={evaluation.result === "✅ pass" ? "text-positive" : "text-accent"}>
                  {evaluation.result === "✅ pass" ? "pass" : evaluation.result}
                </span>
              </p>
            ))}
          </div>
        </article>
        <article className="min-w-0 bg-card p-7 sm:p-9 lg:row-span-4 lg:grid lg:grid-rows-subgrid">
          <span className="font-mono text-[11px] text-muted">03</span>
          <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">
            {showcase.delegationTitle}
          </h3>
          <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">
            {showcase.delegationSummary}
          </p>
          <div className="mt-8 min-h-28 rounded-xl border border-accent/25 bg-accent-soft p-4 font-mono text-[11px] leading-6">
            <p className="text-accent">{showcase.subagent.name} subagent</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-muted">
                {showcase.subagent.baseUsedRuns} / {showcase.subagent.baseTotalRuns}
              </span>
              <span className="h-px flex-1 bg-accent/35" />
              <span className="font-semibold text-accent">
                {showcase.subagent.headUsedRuns} / {showcase.subagent.headTotalRuns}
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
