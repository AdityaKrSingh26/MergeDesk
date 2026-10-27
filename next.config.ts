import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully dynamic desk: in-memory LRU + SSE. Cache Components prerender
  // of `/r/[id]` conflicts with that and with route `maxDuration`.
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
