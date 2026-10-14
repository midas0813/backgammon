import type { NextConfig } from "next";

const X402_STUB = "./lib/stubs/x402-unavailable.ts";

const nextConfig: NextConfig = {
  // Game state is served from a live store; nothing here benefits from prerender caching.
  reactStrictMode: true,
  turbopack: {
    // @coinbase/cdp-sdk (pulled in by wagmi's Base Account connector) lazily imports optional x402
    // packages we don't use. Point them at a stub so the bundle resolves.
    resolveAlias: {
      "@x402/core/client": X402_STUB,
      "@x402/evm": X402_STUB,
      "@x402/evm/exact/client": X402_STUB,
      "@x402/evm/upto/client": X402_STUB,
      "@x402/svm/exact/client": X402_STUB,
      "@x402/extensions": X402_STUB,
    },
  },
};

export default nextConfig;
