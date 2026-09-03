import type { MetadataRoute } from "next";
import { showcase } from "@/lib/showcase";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://diff0.io",
      lastModified: new Date(showcase.capturedAt),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
