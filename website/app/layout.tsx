import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { showcase } from "@/lib/showcase";
import type { Metadata } from "next";
import "./globals.css";

const description =
  "Behavioral diffs for Eve agents. Compare eval evidence across two committed git refs and bring silent drift into your pull request.";

export const metadata: Metadata = {
  metadataBase: new URL("https://diff0.io"),
  title: "diff0 · behavioral diffs for Eve agents",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "diff0 · behavioral diffs for Eve agents",
    description,
    url: "/",
    siteName: "diff0",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: `diff0: real-model drift detected with no confirmed eval regression. ${showcase.subagent.name} subagent ${showcase.subagent.baseUsedRuns}/${showcase.subagent.baseTotalRuns} to ${showcase.subagent.headUsedRuns}/${showcase.subagent.headTotalRuns}; median output tokens ${showcase.featuredMetrics.outputTokens.delta} and duration ${showcase.featuredMetrics.duration.delta}.`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "diff0 · behavioral diffs for Eve agents",
    description,
    images: ["/og.png"],
  },
};

/**
 * Runs before paint. The warm light theme is the product default; an explicit
 * preference persists across visits.
 */
const themeInit = `(function(){try{var t=localStorage.getItem("theme");document.documentElement.classList.add(t==="dark"?"dark":"light")}catch(e){document.documentElement.classList.add("light")}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint: intentional inline theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
