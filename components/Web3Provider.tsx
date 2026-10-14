"use client";

import "@rainbow-me/rainbowkit/styles.css";
import {
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
  createAuthenticationAdapter,
  darkTheme,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { WagmiProvider, useAccount, useDisconnect } from "wagmi";
import { base } from "wagmi/chains";
import { refreshMe, setMe, useMe, type Profile } from "@/lib/client/me";
import { wagmiConfig } from "@/lib/client/wagmi";

const STATEMENT =
  "Sign in to Backgammon. This free signature proves you own this wallet. It does not send a transaction, cost gas or move funds.";

export async function signOutEverywhere() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  await refreshMe().catch(() => {});
}

/** Sign out if the wallet switches to a different account than the one the session belongs to. */
function AccountGuard() {
  const me = useMe();
  const { address } = useAccount();
  useEffect(() => {
    if (me?.registered && me.walletAddress && address && address.toLowerCase() !== me.walletAddress.toLowerCase()) {
      signOutEverywhere();
    }
  }, [me?.registered, me?.walletAddress, address]);
  return null;
}

function Auth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { disconnect } = useDisconnect();
  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  const status: AuthenticationStatus = !me ? "loading" : me.registered ? "authenticated" : "unauthenticated";

  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          const res = await fetch("/api/auth/nonce", { cache: "no-store" });
          if (!res.ok) throw new Error("Could not start sign-in");
          return res.text();
        },
        createMessage: ({ nonce, address, chainId }) =>
          createSiweMessage({
            domain: window.location.host,
            address,
            statement: STATEMENT,
            uri: window.location.origin,
            version: "1",
            chainId,
            nonce,
            issuedAt: new Date(),
            expirationTime: new Date(Date.now() + 10 * 60 * 1000),
          }),
        verify: async ({ message, signature }) => {
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, signature }),
          });
          if (!res.ok) return false;
          const data = (await res.json()) as { isNew: boolean; profile: Profile };
          setMe(data.profile);
          // New wallet = new account: let the player pick a name and photo first.
          if (data.isNew) routerRef.current.push("/welcome");
          else routerRef.current.refresh();
          return true;
        },
        signOut: async () => {
          await signOutEverywhere();
          disconnectRef.current();
        },
      }),
    [],
  );

  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
      <RainbowKitProvider
        initialChain={base}
        modalSize="compact"
        appInfo={{ appName: "Backgammon", learnMoreUrl: "https://ethereum.org/en/wallets/" }}
        theme={darkTheme({
          accentColor: "#65E2BC",
          accentColorForeground: "#0B1220",
          borderRadius: "large",
          overlayBlur: "small",
          fontStack: "system",
        })}
      >
        <AccountGuard />
        {children}
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

export default function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Auth>{children}</Auth>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
