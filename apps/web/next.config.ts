import type { NextConfig } from "next";

// Placeholder config until the web-core build lands (docs/ARCHITECTURE.md §14).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@founder-manager/config",
    "@founder-manager/shared",
    "@founder-manager/dugout",
    "@founder-manager/widgets",
    "@founder-manager/modules",
    "@founder-manager/journey",
    "@founder-manager/entity-linker",
    "@founder-manager/events",
  ],
};

export default nextConfig;
