import { showcase } from "@/lib/showcase";
import { GITHUB } from "./links";
import { Arrow, Mark } from "./shared";

export default function Closing() {
  return (
    <section className="border-t border-line bg-card">
      <div className="mx-auto flex max-w-[1240px] flex-col items-center px-5 py-24 text-center sm:px-8 sm:py-32">
        <span className="mb-8">
          <Mark />
        </span>
        <h2 className="max-w-[760px] text-[clamp(2.7rem,5vw,5rem)] leading-[0.98] font-medium tracking-[-0.06em]">
          Code review for the part of your agent you cannot see.
        </h2>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a
            href={showcase.pullRequestUrl}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg"
          >
            Inspect the live PR <Arrow diagonal />
          </a>
          <a
            href={GITHUB}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-medium"
          >
            Explore on GitHub <Arrow diagonal />
          </a>
        </div>
      </div>
    </section>
  );
}
