import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Game state is served from a live store; nothing here benefits from prerender caching.
  reactStrictMode: true,
  // The server applies supabase/migrations on first start, so ship the SQL with every server function.
  outputFileTracingIncludes: {
    "/*": ["./supabase/migrations/*.sql"],
  },
};

export default nextConfig;
