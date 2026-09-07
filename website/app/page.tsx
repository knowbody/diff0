import Closing from "@/components/home/Closing";
import Evidence from "@/components/home/Evidence";
import Hero from "@/components/home/Hero";
import Principles from "@/components/home/Principles";
import Product from "@/components/home/Product";
import Quickstart from "@/components/home/Quickstart";
import ReportPreview from "@/components/home/ReportPreview";
import Showcase from "@/components/home/Showcase";
import { SiteFooter, SiteHeader } from "@/components/home/SiteChrome";
import Workflow from "@/components/home/Workflow";
import { readContent } from "@/lib/content";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <Hero />
        <Principles />
        <Product />
        <Workflow />
        <Showcase />
        <Evidence />
        <ReportPreview />
        <Quickstart actionYaml={readContent("action.yml")} />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}
