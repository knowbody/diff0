import { Eyebrow } from "./shared";

export default function Workflow() {
  return (
    <section id="workflow" className="border-y border-line bg-card">
      <div className="mx-auto grid max-w-[1240px] lg:grid-cols-[0.78fr_1.22fr]">
        <div className="px-5 py-20 sm:px-8 lg:border-r lg:border-line lg:px-12 lg:py-28">
          <div className="lg:sticky lg:top-28">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="max-w-[470px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">
              Same repo.
              <br />
              Both realities.
            </h2>
            <p className="mt-6 max-w-[430px] leading-7 text-muted">
              diff0 checks out both committed refs, runs each ref&apos;s Eve eval suite, and flags
              evaluator changes that would make the outcomes incomparable.
            </p>
          </div>
        </div>
        <ol className="divide-y divide-line">
          {[
            [
              "01",
              "Checkout",
              "Base and head run in isolated git worktrees. A dirty local HEAD is rejected so edits are never silently omitted.",
            ],
            ["02", "Run", "Existing Eve evals run N times per ref in counterbalanced AB/BA order."],
            [
              "03",
              "Collect",
              "Tool calls, subagents, skills, tokens, available cost, and duration come from Eve's own artifacts.",
            ],
            [
              "04",
              "Report",
              "Statistical changes and stable behavioral drift land in the terminal and one sticky PR comment.",
            ],
          ].map(([n, title, copy]) => (
            <li
              key={n}
              className="grid grid-cols-[52px_1fr] gap-4 px-5 py-9 sm:grid-cols-[72px_1fr] sm:px-10 sm:py-11"
            >
              <span className="font-mono text-xs text-muted">{n}</span>
              <div>
                <h3 className="text-xl font-medium tracking-[-0.025em]">{title}</h3>
                <p className="mt-2 max-w-[520px] leading-7 text-muted">{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
