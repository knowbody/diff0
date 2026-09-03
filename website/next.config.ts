import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const websiteRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  agentRules: false,
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  turbopack: { root: websiteRoot },
};

export default nextConfig;
