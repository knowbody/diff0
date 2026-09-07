import CopyButton from "@/components/CopyButton";
import { CLONE_CMD, GITHUB, RUN_CMD } from "./links";
import { Arrow, Command } from "./shared";

export default function Quickstart({ actionYaml }: { actionYaml: string }) {
  return (
    <section id="quickstart" className="border-t border-line">
      <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="relative overflow-hidden rounded-[24px] bg-panel px-6 py-14 text-white sm:px-12 sm:py-16 lg:px-16">
          <div className="cta-grid" aria-hidden="true" />
          <div className="relative grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <p className="mb-5 font-mono text-[11px] tracking-[0.16em] opacity-60 uppercase">
                Run it on your agent
              </p>
              <h2 className="max-w-[530px] text-[clamp(2.6rem,5vw,4.6rem)] leading-[0.98] font-medium tracking-[-0.055em]">
                Compare two refs.
                <br />
                Review one report.
              </h2>
              <p className="mt-6 max-w-[480px] leading-7 opacity-55">
                From a repository with an Eve eval suite, compare the branch you plan to merge
                against its base. Commit both refs, install your app’s dependencies, and configure
                its model credentials. No global diff0 install is required.
              </p>
            </div>
            <div className="min-w-0">
              <Command command={RUN_CMD} inverse />
              <a
                href={`${GITHUB}/blob/main/GETTING_STARTED.md`}
                className="mt-4 inline-flex items-center gap-2 text-sm underline underline-offset-4"
              >
                Getting Started: baseline, evals, and credentials <Arrow diagonal />
              </a>
            </div>
          </div>
          <div className="relative mt-12 border-t border-current/15 pt-8">
            <p className="mb-3 text-xs opacity-60">Want to inspect or develop diff0 itself?</p>
            <Command command={CLONE_CMD} inverse />
          </div>
        </div>

        <div className="mt-16 grid gap-10 border-t border-line pt-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h3 className="text-xl font-medium tracking-[-0.025em]">Add it to CI</h3>
            <p className="mt-3 max-w-[430px] text-sm leading-6 text-muted">
              Run the comparison on pull requests and post one self-updating comment. The default
              blocks red regressions but reports yellow drift without failing; granular policies can
              gate eval, score, performance, behavioral, and validity findings independently. Fork
              PRs stay refused by default.
            </p>
            <div className="mt-5 inline-flex">
              <CopyButton text={actionYaml} label="Copy workflow YAML" />
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-codebg">
            <pre className="min-w-max px-5 py-5 font-mono text-[12px] leading-6">{actionYaml}</pre>
          </div>
        </div>
        <div className="mt-12 border-t border-line pt-12">
          <p className="mb-3 font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
            Library API preview
          </p>
          <h3 className="text-xl font-medium tracking-[-0.025em]">
            Build diff0 into your own tooling
          </h3>
          <p className="mt-3 max-w-[680px] text-sm leading-6 text-muted">
            Compare records collected by your own host, or use the Node.js runner to compare Git
            refs through Eve. Separate comparison, adapter, and reporting entrypoints let you own
            the workflow and where the results go.
          </p>
          <p className="mt-3 max-w-[680px] text-sm leading-6 text-muted">
            Included as a preview in diff0 v0.1.4.
          </p>
          <a
            href={`${GITHUB}/blob/main/docs/library-api.md`}
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
          >
            Explore the library API preview <Arrow diagonal />
          </a>
        </div>
      </div>
    </section>
  );
}
