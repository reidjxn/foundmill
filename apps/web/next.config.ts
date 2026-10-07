import type { NextConfig } from "next";

// Placeholder config until the web-core build lands (docs/ARCHITECTURE.md §14).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@foundmill/config",
    "@foundmill/shared",
    "@foundmill/dugout",
    "@foundmill/widgets",
    "@foundmill/modules",
    "@foundmill/journey",
    "@foundmill/entity-linker",
    "@foundmill/events",
  ],
};

export default nextConfig;
