import CopyButton from "@/components/CopyButton";
import PrComment from "@/components/PrComment";
import ThemeToggle from "@/components/ThemeToggle";
import { readContent } from "@/lib/content";
import { showcase } from "@/lib/showcase";

const GITHUB = "https://github.com/knowbody/diff0";
const X = "https://x.com/matzatorski";
const SHOWCASE_PR = showcase.pullRequestUrl;
const RUN_CMD = "npx @knowbody/diff0 run --base main";
const CLONE_CMD = "git clone https://github.com/knowbody/diff0 && cd diff0";

function Mark() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="diff0">
      <svg className="h-[18px] w-[18px]" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M38 16.1A17 17 0 1 0 38 47.9" stroke="currentColor" strokeWidth="4" strokeLinecap="square" />
        <path d="m36 23 9 9-9 9" stroke="currentColor" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">diff0</span>
    </span>
  );
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d={diagonal ? "M3 11L11 3M5 3h6v6" : "M2 7h10m-3-3 3 3-3 3"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 flex items-center justify-center gap-2 font-mono text-[11px] font-medium tracking-[0.16em] text-muted uppercase lg:justify-start">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {children}
    </p>
  );
}

function Command({ command, inverse = false }: { command: string; inverse?: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-full border py-2 pr-2 pl-4 ${
        inverse
          ? "border-white/15 bg-white/[0.06] text-white"
          : "border-line bg-card text-fg shadow-[0_1px_0_rgba(0,0,0,0.03)]"
      }`}
    >
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] whitespace-nowrap">
        <span className={inverse ? "text-white/60" : "text-muted"}>$ </span>
        {command}
      </code>
      <CopyButton text={command} />
    </div>
  );
}

function ResultRow({ label, from, to, tone = "neutral" }: {
  label: string;
  from: string;
  to: string;
  tone?: "neutral" | "warning" | "good";
}) {
  const toneClass =
    tone === "warning" ? "text-[#f5ae2d]" : tone === "good" ? "text-[#61c978]" : "text-white/70";
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-white/10 py-3.5 font-mono text-[11px] sm:grid-cols-[1fr_88px_88px] sm:text-xs">
      <span className={toneClass}>{label}</span>
      <span className="text-right text-white/60">{from}</span>
      <span className="text-right text-white">{to}</span>
    </div>
  );
}

export default function Home() {
  const actionYaml = readContent("action.yml");

  return (
    <>
      <header className="relative z-20 border-b border-line bg-bg/90 backdrop-blur-xl">
        <nav aria-label="Primary navigation" className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <a href="#top" className="rounded-sm"><Mark /></a>
          <div className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a className="transition-colors hover:text-fg" href="#product">Product</a>
            <a className="transition-colors hover:text-fg" href="#workflow">How it works</a>
            <a className="transition-colors hover:text-fg" href="#evidence">Evidence</a>
            <a className="transition-colors hover:text-fg" href="#quickstart">Quickstart</a>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href={GITHUB} className="group inline-flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5">
              GitHub <Arrow diagonal />
            </a>
          </div>
        </nav>
        <nav aria-label="Section navigation" className="flex gap-5 overflow-x-auto border-t border-line px-5 py-2.5 text-xs text-muted md:hidden">
          <a className="shrink-0" href="#product">Product</a>
          <a className="shrink-0" href="#workflow">How it works</a>
          <a className="shrink-0" href="#evidence">Evidence</a>
          <a className="shrink-0" href="#quickstart">Quickstart</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero-grid relative overflow-hidden border-b border-line">
          <div className="mx-auto max-w-[1240px] px-5 pt-20 pb-14 text-center sm:px-8 sm:pt-28 lg:pt-36">
            <a href={SHOWCASE_PR} className="group mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-muted shadow-sm transition-colors hover:text-fg">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-accent uppercase">v{showcase.releaseVersion}</span>
              See the live real-model run
              <span className="transition-transform group-hover:translate-x-0.5"><Arrow /></span>
            </a>

            <h1 className="mx-auto max-w-[970px] text-[clamp(3.25rem,7.8vw,7rem)] leading-[0.92] font-medium tracking-[-0.065em] text-balance">
              Review the agent,
              <br />
              <span className="font-editorial font-normal tracking-[-0.045em] italic">not just the diff.</span>
            </h1>
            <p className="mx-auto mt-8 max-w-[660px] text-lg leading-8 text-muted text-balance sm:text-xl">
              diff0 compares how your Eve agent behaves across two committed refs—so captured behavioral changes can show up before you merge them.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={SHOWCASE_PR} className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5 sm:w-auto">
                Open the showcase PR <Arrow diagonal />
              </a>
              <a href={GITHUB} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-5 text-sm font-medium transition-colors hover:bg-codebg sm:w-auto">
                View the source <Arrow diagonal />
              </a>
            </div>

            <div className="relative mx-auto mt-20 max-w-[1050px] text-left sm:mt-24">
              <div className="hero-glow" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-[18px] border border-black/15 bg-[#0c0c0c] shadow-[0_40px_100px_rgba(0,0,0,0.18)]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="flex gap-1.5" aria-hidden="true">
                      <span className="h-2 w-2 rounded-full bg-white/15" />
                      <span className="h-2 w-2 rounded-full bg-white/15" />
                      <span className="h-2 w-2 rounded-full bg-white/15" />
                    </span>
                    <span className="font-mono text-[11px] text-white/60">diff0 / {showcase.head.ref}</span>
                  </div>
                  <span className="hidden items-center gap-2 font-mono text-[10px] tracking-wider text-white/60 uppercase sm:flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#61c978]" /> comparison complete
                  </span>
                </div>
                <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="border-b border-white/10 p-5 sm:p-8 lg:border-r lg:border-b-0">
                    <p className="mb-7 font-mono text-[10px] tracking-[0.16em] text-white/60 uppercase">source change</p>
                    <div className="font-mono text-xs leading-7 text-white/60 sm:text-[13px]">
                      <p className="text-white/60">agent/instructions.md</p>
                      <p className="mt-3 rounded bg-[#ef5b5b]/10 px-2 text-[#ff8585]">− After computing a figure, delegate a one-line executive summary to the</p>
                      <p className="rounded bg-[#ef5b5b]/10 px-2 text-[#ff8585]">− `reporter` subagent before replying.</p>
                    </div>
                    <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.035] p-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/60">Eval observations</span>
                        <span className="inline-flex items-center gap-1.5 text-[#61c978]"><span className="h-1.5 w-1.5 rounded-full bg-current" />{showcase.evalObservationTotal.passed} / {showcase.evalObservationTotal.total} passed</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-5 sm:p-8">
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-[10px] tracking-[0.16em] text-white/60 uppercase">behavioral comparison</p>
                        <p className="mt-2 text-lg font-medium text-white">Drift detected</p>
                      </div>
                      <span className="rounded-full border border-[#f5ae2d]/30 bg-[#f5ae2d]/10 px-2.5 py-1 font-mono text-[10px] text-[#f5ae2d]">review</span>
                    </div>
                    <ResultRow label={`${showcase.subagent.name} subagent`} from={showcase.subagent.base} to={showcase.subagent.head} tone="warning" />
                    <ResultRow label="eval observations" from={showcase.evalPasses.base} to={showcase.evalPasses.head} />
                    <ResultRow label="output tokens / run" from={showcase.featuredMetrics.outputTokens.baseShort} to={showcase.featuredMetrics.outputTokens.headShort} tone="good" />
                    <ResultRow label="duration / run" from={showcase.featuredMetrics.duration.baseShort} to={showcase.featuredMetrics.duration.headShort} tone="good" />
                    <div className="mt-5 flex items-center gap-3 text-[11px] text-white/60">
                      <span>Fisher exact + Holm adjustment</span><span>·</span><span>N={showcase.runsPerRef} per ref</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-5 text-center font-mono text-[10px] tracking-[0.14em] text-muted uppercase">One two-line prompt edit · {showcase.runsPerRef * 2} real-model suites · automated in GitHub Actions</p>
            </div>
          </div>
        </section>

        <section className="border-b border-line" aria-label="Product principles">
          <div className="mx-auto grid max-w-[1240px] grid-cols-2 divide-x divide-line px-5 sm:px-8 md:grid-cols-4">
            {[
              ["Eve-native", "Reads captured Eve eval JSON and events"],
              ["Two refs", "Base behavior vs. head behavior"],
              ["N runs", "Evidence, not anecdotes"],
              ["One comment", "The result lives in your PR"],
            ].map(([title, copy]) => (
              <div key={title} className="py-6 pr-4 pl-4 first:pl-0 md:px-6 md:first:pl-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-[820px] text-center">
            <Eyebrow>The gap after evals</Eyebrow>
            <h2 className="text-[clamp(2.5rem,5vw,4.75rem)] leading-[1] font-medium tracking-[-0.055em] text-balance">
              Your eval passed.<br />Your agent still changed.
            </h2>
            <p className="mx-auto mt-7 max-w-[640px] text-lg leading-8 text-muted">
              A scorer tells you whether the answer was acceptable. diff0 shows captured evidence about how the agent got there—and whether that behavior moved with your code.
            </p>
          </div>

          <div className="mt-16 grid overflow-hidden rounded-2xl border border-line bg-line shadow-[0_24px_80px_rgba(0,0,0,0.06)] lg:grid-cols-3 lg:gap-px">
            <article className="bg-card p-7 sm:p-9">
              <span className="font-mono text-[11px] text-muted">01</span>
              <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">A tiny edit</h3>
              <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">Two prompt lines disappear. The source diff looks harmless.</p>
              <div className="mt-8 rounded-xl border border-line bg-codebg p-4 font-mono text-[11px] leading-6">
                <p className="text-muted">instructions.md</p>
                <p className="mt-2 -mx-1 rounded bg-red-500/10 px-1 text-red-500">− Delegate to reporter</p>
                <p className="-mx-1 rounded bg-red-500/10 px-1 text-red-500">− Use its final answer</p>
              </div>
            </article>
            <article className="bg-card p-7 sm:p-9">
              <span className="font-mono text-[11px] text-muted">02</span>
              <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">Green evals</h3>
              <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">The head clears every eval observation. Repetition can reveal what one green run misses.</p>
              <div className="mt-8 rounded-xl border border-line bg-codebg p-4 font-mono text-[11px] leading-6">
                {["no-failed-actions", "uses-sql-tool", "total-revenue"].map((x) => (
                  <p key={x} className="flex items-center justify-between gap-3"><span className="truncate text-muted">{x}</span><span className="text-green-600">pass</span></p>
                ))}
              </div>
            </article>
            <article className="bg-card p-7 sm:p-9">
              <span className="font-mono text-[11px] text-muted">03</span>
              <h3 className="mt-12 text-xl font-medium tracking-[-0.025em]">Visible drift</h3>
              <p className="mt-2 max-w-[18rem] text-sm leading-6 text-muted">Repeated runs reveal that delegation vanished completely.</p>
              <div className="mt-8 rounded-xl border border-accent/25 bg-accent-soft p-4 font-mono text-[11px] leading-6">
                <p className="text-accent">{showcase.subagent.name} subagent</p>
                <div className="mt-3 flex items-center gap-2"><span className="text-muted">{showcase.subagent.baseUsedRuns} / {showcase.subagent.baseTotalRuns}</span><span className="h-px flex-1 bg-accent/35" /><span className="font-semibold text-accent">{showcase.subagent.headUsedRuns} / {showcase.subagent.headTotalRuns}</span></div>
              </div>
            </article>
          </div>
        </section>

        <section id="workflow" className="border-y border-line bg-card">
          <div className="mx-auto grid max-w-[1240px] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="px-5 py-20 sm:px-8 lg:border-r lg:border-line lg:px-12 lg:py-28">
              <div className="lg:sticky lg:top-28">
                <Eyebrow>How it works</Eyebrow>
                <h2 className="max-w-[470px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">Same repo.<br />Both realities.</h2>
                <p className="mt-6 max-w-[430px] leading-7 text-muted">diff0 checks out both committed refs, runs each ref&apos;s Eve eval suite, and flags evaluator changes that would make the outcomes incomparable.</p>
              </div>
            </div>
            <ol className="divide-y divide-line">
              {[
                ["01", "Checkout", "Base and head run in isolated git worktrees. A dirty local HEAD is rejected so edits are never silently omitted."],
                ["02", "Run", "Existing Eve evals run N times per ref in counterbalanced AB/BA order."],
                ["03", "Collect", "Tool calls, subagents, skills, tokens, available cost, and duration come from Eve's own artifacts."],
                ["04", "Report", "Statistical changes and stable behavioral drift land in the terminal and one sticky PR comment."],
              ].map(([n, title, copy]) => (
                <li key={n} className="grid grid-cols-[52px_1fr] gap-4 px-5 py-9 sm:grid-cols-[72px_1fr] sm:px-10 sm:py-11">
                  <span className="font-mono text-xs text-muted">{n}</span>
                  <div><h3 className="text-xl font-medium tracking-[-0.025em]">{title}</h3><p className="mt-2 max-w-[520px] leading-7 text-muted">{copy}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="demo" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
          <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div><Eyebrow>Live proof, not a mock</Eyebrow><h2 className="max-w-[720px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">Inspect the run, the checks, and the source diff.</h2></div>
            <p className="max-w-[430px] text-sm leading-6 text-muted">GitHub Actions called {showcase.modelDisplay} for {showcase.runsPerRef} runs per ref. The PR stays open so every claim can be checked against the workflow and bot-authored report.</p>
          </div>
          <div className="grid overflow-hidden rounded-[20px] border border-line bg-card shadow-[0_28px_90px_rgba(0,0,0,0.1)] lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-7 sm:p-10 lg:border-r lg:border-line">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">Authoritative evidence</p>
              <h3 className="mt-5 max-w-[580px] text-3xl font-medium tracking-[-0.04em]">One public PR. Real model calls. Reproducible provenance.</h3>
              <p className="mt-5 max-w-[610px] leading-7 text-muted">The head passed all 30 eval observations while confirmed reporter delegation fell from 10/10 to 0/10 in each of three evals. The yellow verdict asks a human to review an intentional behavioral change.</p>
              <a href={SHOWCASE_PR} className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg">Open PR #8 <Arrow diagonal /></a>
            </div>
            <div className="divide-y divide-line">
              {[["Model", showcase.model], ["Runs", `${showcase.runsPerRef} per ref`], ["Output tokens", `median ${showcase.featuredMetrics.outputTokens.delta.replace("-", "−")}`], ["Duration", `median ${showcase.featuredMetrics.duration.delta.replace("-", "−")}`], ["Cost", "unavailable; no savings claim"]].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-5 px-7 py-5 text-sm"><span className="text-muted">{label}</span><span className="text-right font-mono text-xs">{value}</span></div>
              ))}
            </div>
          </div>
        </section>

        <section id="evidence" className="border-y border-line bg-[#111] text-white">
          <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
            <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
              <div>
                <p className="mb-5 flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-white/60 uppercase"><span className="h-1.5 w-1.5 rounded-full bg-[#f5ae2d]" />Evidence, with limits</p>
                <h2 className="text-[clamp(2.7rem,5vw,4.75rem)] leading-[0.98] font-medium tracking-[-0.055em]">Honest about what the runs can prove.</h2>
                <p className="mt-7 max-w-[520px] text-lg leading-8 text-white/55">diff0 separates regression, inconclusive movement, and behavioral drift. It shows uncertainty instead of painting every change red.</p>
              </div>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                {[[`N=${showcase.runsPerRef}`, "runs per ref"], [`${showcase.evalObservationTotal.passed} / ${showcase.evalObservationTotal.total}`, "eval observations passed"], ["1", "source file changed"], ["1", "sticky PR comment"]].map(([value, label]) => (
                  <div key={label} className="bg-[#111] p-6 sm:p-8"><p className="font-mono text-2xl tracking-[-0.04em] sm:text-3xl">{value}</p><p className="mt-2 text-xs text-white/60">{label}</p></div>
                ))}
              </div>
            </div>
            <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-3">
              {[
                ["Pass-rate evidence", "One-sided Fisher exact tests compare differing proportions across runs."],
                ["Multiple comparisons", "Holm adjustment keeps a suite full of evals from manufacturing confidence."],
                ["Validity caps", "Changed eval harness, authored sandbox configuration, model, run count, or scorer validity caps the verdict at yellow."],
              ].map(([title, copy]) => (
                <div key={title} className="bg-[#111] p-7 sm:p-9"><div className="mb-10 h-8 w-8 rounded-full border border-white/15 bg-white/[0.03]" /><h3 className="font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-white/60">{copy}</p></div>
              ))}
            </div>
            <p className="mt-7 max-w-[780px] text-sm leading-6 text-white/60">Drift is not automatically bad. diff0 reports only what Eve captured; it does not prove semantic equivalence or decide whether a change is desirable. In the showcase, removing delegation coincided with {showcase.featuredMetrics.outputTokens.delta.replace("-", "")} fewer median output tokens and {showcase.featuredMetrics.duration.delta.replace("-", "")} lower median duration. Cost stayed unavailable because delegated base usage was not fully attributed, so diff0 makes no savings claim.</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
          <div className="mb-12 text-center">
            <Eyebrow>In your pull request</Eyebrow>
            <h2 className="mx-auto max-w-[760px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">The report goes where the decision happens.</h2>
            <p className="mx-auto mt-6 max-w-[580px] leading-7 text-muted">One comment updates in place on every push. No dashboard to remember, no second review loop.</p>
          </div>
          <div className="rounded-[20px] border border-line bg-codebg p-3 shadow-[0_28px_90px_rgba(0,0,0,0.08)] sm:p-6 lg:p-10"><PrComment /></div>
        </section>

        <section id="quickstart" className="border-t border-line">
          <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
            <div className="relative overflow-hidden rounded-[24px] bg-[#111] px-6 py-14 text-white sm:px-12 sm:py-16 lg:px-16">
              <div className="cta-grid" aria-hidden="true" />
              <div className="relative grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
                <div>
                  <p className="mb-5 font-mono text-[11px] tracking-[0.16em] opacity-60 uppercase">Run it on your agent</p>
                  <h2 className="max-w-[530px] text-[clamp(2.6rem,5vw,4.6rem)] leading-[0.98] font-medium tracking-[-0.055em]">Compare two refs.<br />Review one report.</h2>
                  <p className="mt-6 max-w-[480px] leading-7 opacity-55">From a repository with an Eve eval suite, compare the branch you plan to merge against its base. No global diff0 install is required.</p>
                </div>
                <div className="min-w-0"><Command command={RUN_CMD} inverse /></div>
              </div>
              <div className="relative mt-12 border-t border-current/15 pt-8"><p className="mb-3 text-xs opacity-60">Want to inspect or develop diff0 itself?</p><Command command={CLONE_CMD} inverse /></div>
            </div>

            <div className="mt-16 grid gap-10 border-t border-line pt-12 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <h3 className="text-xl font-medium tracking-[-0.025em]">Add it to CI</h3>
                <p className="mt-3 max-w-[430px] text-sm leading-6 text-muted">Run the comparison on pull requests and post one self-updating comment. The default blocks red regressions but reports yellow drift without failing; granular policies can gate eval, score, performance, behavioral, and validity findings independently. Fork PRs stay refused by default.</p>
                <div className="mt-5 inline-flex"><CopyButton text={actionYaml} label="Copy workflow YAML" /></div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-codebg"><pre className="min-w-max px-5 py-5 font-mono text-[12px] leading-6">{actionYaml}</pre></div>
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-card">
          <div className="mx-auto flex max-w-[1240px] flex-col items-center px-5 py-24 text-center sm:px-8 sm:py-32">
            <span className="mb-8"><Mark /></span>
            <h2 className="max-w-[760px] text-[clamp(2.7rem,5vw,5rem)] leading-[0.98] font-medium tracking-[-0.06em]">Code review for the part of your agent you cannot see.</h2>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={SHOWCASE_PR} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg">Inspect the live PR <Arrow diagonal /></a>
              <a href={GITHUB} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-medium">Explore on GitHub <Arrow diagonal /></a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-card">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto_auto] md:items-end md:gap-16">
          <div><Mark /><p className="mt-4 max-w-[330px] text-xs leading-5 text-muted">Behavioral diffs for Eve agents. Open source and MIT licensed.</p></div>
          <div className="text-sm"><p className="mb-3 text-xs text-muted">Product</p><div className="flex flex-col gap-2"><a href="#workflow" className="hover:text-muted">How it works</a><a href="#evidence" className="hover:text-muted">Evidence</a><a href="#quickstart" className="hover:text-muted">Quickstart</a></div></div>
          <div className="text-sm"><p className="mb-3 text-xs text-muted">Elsewhere</p><div className="flex flex-col gap-2"><a href={GITHUB} className="hover:text-muted">GitHub</a><a href={X} className="hover:text-muted">X / Twitter</a><a href="https://eve.dev" className="hover:text-muted">Eve</a></div></div>
        </div>
        <div className="mx-auto flex max-w-[1240px] items-center justify-between border-t border-line px-5 py-5 text-[11px] text-muted sm:px-8"><span>© 2026 diff0</span><span>Built for agents that change.</span></div>
      </footer>
    </>
  );
}
