"use client";

import { createConfig, http } from "wagmi";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { BRAND } from "@/lib/brand";

/**
 * wagmi configuration. Browser wallets (MetaMask, Rabby, Brave, Trust and wallet in-app browsers)
 * announce themselves (EIP-6963) and each appears by name; Coinbase Wallet is always offered.
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (free at https://cloud.reown.com) adds WalletConnect: a QR code
 * on desktop and links into mobile wallet apps.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const chains = [base, mainnet, optimism, arbitrum, polygon, baseSepolia, sepolia] as const;

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    injected(),
    coinbaseWallet({ appName: BRAND.name }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: true,
            metadata: { name: BRAND.name, description: BRAND.tagline, url: "https://backgammon-iota-gules.vercel.app", icons: [] },
          }),
        ]
      : []),
  ],
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
