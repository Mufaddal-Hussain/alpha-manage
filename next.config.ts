import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Price-list uploads (template plus an optional reference PDF of up to 15 MB) go through a Server Action.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  // The PDF routes read the bundled font from disk, which the file tracer cannot see on its own (Vercel).
  outputFileTracingIncludes: {
    "/api/documents/**": ["src/lib/pdf/fonts/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
