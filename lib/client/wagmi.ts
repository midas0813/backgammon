"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from "wagmi/chains";
import { BRAND } from "@/lib/brand";

/**
 * wagmi + RainbowKit configuration.
 *
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (free at https://cloud.reown.com) enables WalletConnect:
 * QR codes on desktop and deep links into mobile wallet apps. Without it only wallets injected
 * into the browser (MetaMask/Rabby/Brave extensions, wallet in-app browsers) and Coinbase Wallet work.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const chains = [base, mainnet, optimism, arbitrum, polygon, baseSepolia, sepolia] as const;

const wallets = WALLETCONNECT_PROJECT_ID
  ? [
      { groupName: "Popular", wallets: [metaMaskWallet, coinbaseWallet, rainbowWallet, walletConnectWallet] },
      { groupName: "More", wallets: [rabbyWallet, trustWallet, injectedWallet] },
    ]
  : [{ groupName: "Available", wallets: [injectedWallet, coinbaseWallet, rabbyWallet] }];

export const wagmiConfig = createConfig({
  chains,
  connectors: connectorsForWallets(wallets, {
    appName: BRAND.name,
    appDescription: BRAND.tagline,
    projectId: WALLETCONNECT_PROJECT_ID || "walletconnect-disabled",
  }),
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>,
  ssr: true,
});
