import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The site is a public compliance surface; advertising the framework version buys
  // an attacker a version-specific exploit list and buys us nothing.
  poweredByHeader: false,
  output: "standalone",
  // Tracing must see the whole npm workspace, not just apps/web, or the standalone
  // bundle ships without the hoisted node_modules and without @peraplano/common.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@peraplano/common"],
};

export default nextConfig;
