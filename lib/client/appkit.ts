"use client";

import { createAppKit } from "@reown/appkit/react";
import { BRAND } from "@/lib/brand";
import { appKitAdapter, chains, SITE_URL, WALLETCONNECT_PROJECT_ID } from "./wagmi";

/**
 * Reown AppKit: the wallet window when a Reown project ID is set (null otherwise). It only connects a
 * wallet; signing in is still the app's own Sign-In with Ethereum step, checked by the server.
 * Email/social wallets, swaps, on-ramp and analytics are off.
 */
export const appKit =
  appKitAdapter && typeof window !== "undefined"
    ? createAppKit({
        adapters: [appKitAdapter],
        networks: [...chains],
        defaultNetwork: chains[0],
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: { name: BRAND.name, description: BRAND.tagline, url: SITE_URL, icons: [`${SITE_URL}/favicon.ico`] },
        features: { email: false, socials: false, swaps: false, onramp: false, send: false, history: false, analytics: false },
        termsConditionsUrl: `${SITE_URL}/legal/terms`,
        privacyPolicyUrl: `${SITE_URL}/legal/privacy`,
        themeMode: "dark",
        themeVariables: {
          "--w3m-accent": "#65e2bc",
          "--w3m-color-mix": "#0b1220",
          "--w3m-color-mix-strength": 40,
          "--w3m-font-family": "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          "--w3m-border-radius-master": "3px",
          "--w3m-z-index": 100,
        },
      })
    : null;
