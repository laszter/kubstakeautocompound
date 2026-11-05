import path from "node:path";
import type { NextConfig } from "next";

// Monorepo root (apps/web -> ../../). Used for standalone file tracing and Turbopack root,
// so the standalone server ends up at .next/standalone/apps/web/server.js.
const repoRoot = path.join(__dirname, "../../");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  transpilePackages: ["@kubstake/core", "@kubstake/db"],
  serverExternalPackages: ["pg", "pino", "@node-rs/argon2"],
};

export default nextConfig;
