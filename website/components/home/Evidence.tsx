import { showcase } from "@/lib/showcase";

export default function Evidence() {
  return (
    <section id="evidence" className="border-y border-line bg-panel text-white">
      <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
          <div>
            <p className="mb-5 flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-white/60 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-panel-warning" />
              Evidence, with limits
            </p>
            <h2 className="text-[clamp(2.7rem,5vw,4.75rem)] leading-[0.98] font-medium tracking-[-0.055em]">
              Honest about what the runs can prove.
            </h2>
            <p className="mt-7 max-w-[520px] text-lg leading-8 text-white/55">
              diff0 separates regression, inconclusive movement, and behavioral drift. It shows
              uncertainty instead of painting every change red.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
            {[
              [`N=${showcase.runsPerRef}`, "runs per ref"],
              [
                `${showcase.evalObservationTotal.passed} / ${showcase.evalObservationTotal.total}`,
                "eval observations passed",
              ],
              [String(showcase.sourceFileCount), "source file changed"],
              ["1", "sticky PR comment"],
            ].map(([value, label]) => (
              <div key={label} className="bg-panel p-6 sm:p-8">
                <p className="font-mono text-2xl tracking-[-0.04em] sm:text-3xl">{value}</p>
                <p className="mt-2 text-xs text-white/60">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-3">
          {[
            [
              "Pass-rate evidence",
              "One-sided Fisher exact tests compare differing proportions across runs.",
            ],
            [
              "Multiple comparisons",
              "Holm adjustment keeps a suite full of evals from manufacturing confidence.",
            ],
            [
              "Validity caps",
              "Changed eval harness, authored sandbox configuration, model, run count, or scorer validity caps the verdict at yellow.",
            ],
          ].map(([title, copy]) => (
            <div key={title} className="bg-panel p-7 sm:p-9">
              <div className="mb-10 h-8 w-8 rounded-full border border-white/15 bg-white/[0.03]" />
              <h3 className="font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{copy}</p>
            </div>
          ))}
        </div>
        <p className="mt-7 max-w-[780px] text-sm leading-6 text-white/60">
          Drift is not automatically bad. diff0 reports only what Eve captured; it does not prove
          semantic equivalence or decide whether a change is desirable. In the showcase, removing
          delegation coincided with {showcase.performanceSummary}. Base cost stayed unavailable
          because delegated base usage was not fully attributed, so diff0 makes no savings claim.
        </p>
      </div>
    </section>
  );
}
