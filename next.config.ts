import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Game state is served from a live in-process store; nothing here benefits from prerender caching.
  reactStrictMode: true,
};

export default nextConfig;
