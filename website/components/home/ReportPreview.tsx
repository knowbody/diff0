import PrComment from "@/components/PrComment";
import { Eyebrow } from "./shared";

export default function ReportPreview() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 text-center">
        <Eyebrow centered>In your pull request</Eyebrow>
        <h2 className="mx-auto max-w-[760px] text-[clamp(2.6rem,5vw,4.5rem)] leading-[1] font-medium tracking-[-0.055em]">
          The report goes where the decision happens.
        </h2>
        <p className="mx-auto mt-6 max-w-[580px] leading-7 text-muted">
          One comment updates in place on every push. No dashboard to remember, no second review
          loop.
        </p>
      </div>
      <div className="rounded-[20px] border border-line bg-codebg p-3 shadow-[0_28px_90px_rgba(0,0,0,0.08)] sm:p-6 lg:p-10">
        <PrComment />
      </div>
    </section>
  );
}
