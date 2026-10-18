"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createConfig, http, type Config } from "wagmi";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from "wagmi/chains";
import { coinbaseWallet, injected, metaMask } from "wagmi/connectors";
import { BRAND } from "@/lib/brand";

/**
 * wagmi configuration.
 * With NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (a Reown project, free at https://dashboard.reown.com) the
 * wallet window is Reown AppKit: browser wallets, WalletConnect QR codes and links into 500+ mobile
 * wallet apps. AppKit's adapter builds the wagmi config.
 * Without it, the app's own dialog lists browser wallets (EIP-6963, each by name), the MetaMask app and
 * Coinbase Wallet, so phones still work.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const chains = [base, mainnet, optimism, arbitrum, polygon, baseSepolia, sepolia] as const;

export const SITE_URL = "https://backgammon-iota-gules.vercel.app";

export const appKitAdapter = WALLETCONNECT_PROJECT_ID ? new WagmiAdapter({ projectId: WALLETCONNECT_PROJECT_ID, networks: [...chains], ssr: true }) : null;

export const wagmiConfig: Config =
  appKitAdapter?.wagmiConfig ??
  createConfig({
    chains,
    connectors: [
      injected(),
      // MetaMask's own connector reaches the MetaMask phone app (QR code on desktop, app link on a
      // phone) without a WalletConnect project. Its analytics are off.
      metaMask({ dappMetadata: { name: BRAND.name, url: SITE_URL }, analytics: { enabled: false } }),
      coinbaseWallet({ appName: BRAND.name }),
    ],
    transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>,
    ssr: true,
  });
