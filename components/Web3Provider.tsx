"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, useConnection } from "wagmi";
import WalletDialog from "@/components/WalletDialog";
import { refreshMe, useMe } from "@/lib/client/me";
import { wagmiConfig } from "@/lib/client/wagmi";

export async function signOutEverywhere() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  await refreshMe().catch(() => {});
}

/** Sign out if the wallet switches to a different account than the one the session belongs to. */
function AccountGuard() {
  const me = useMe();
  const { address } = useConnection();
  useEffect(() => {
    if (me?.registered && me.walletAddress && address && address.toLowerCase() !== me.walletAddress.toLowerCase()) {
      signOutEverywhere();
    }
  }, [me?.registered, me?.walletAddress, address]);
  return null;
}

/** Wallet state for the whole app: wagmi, the connect dialog and the account guard. */
export default function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AccountGuard />
        <WalletDialog />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
