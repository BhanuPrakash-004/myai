import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Web + backend API container. Persistent storage is required; a serverless
  // filesystem is not a supported data backend.
  output: "standalone",
  outputFileTracingExcludes: { "/*": ["./.env*", "./data/**/*", "./vault/**/*", "./backups/**/*", "./tests/**/*"] },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
