"use client";

import { createConfig, http, injected, type Config } from "wagmi";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from "wagmi/chains";

/**
 * wagmi configuration: browser wallets only. Every wallet that announces itself (EIP-6963: MetaMask,
 * Rabby, Coinbase, Trust, OKX, Phantom… and the wallet apps' own browsers) gets its own connector,
 * and `injected()` covers a wallet that doesn't announce itself. There is no WalletConnect and no QR
 * code: on a phone without a wallet browser, the wallet window opens this site inside the wallet app.
 */
export const chains = [base, mainnet, optimism, arbitrum, polygon, baseSepolia, sepolia] as const;

export const wagmiConfig: Config = createConfig({
  chains,
  connectors: [injected()],
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>,
  ssr: true,
});
