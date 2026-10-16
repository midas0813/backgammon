"use client";

import { useCallback } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { getConnection, reconnect } from "wagmi/actions";
import { ClientApiError, api } from "./api";
import { wagmiConfig } from "./wagmi";
import { openWalletDialog } from "./wallet";

export interface SignDetails {
  action: string;
  target?: string;
  reason?: string;
}
export interface Proof {
  nonce: string;
  signature: string;
}

/**
 * Get a server-issued admin challenge signed by the connected wallet. The server checks the wallet
 * is this account's and that the message names exactly this action, target and reason.
 */
export function useAdminSigner(expectedWallet: string | null) {
  const { address, isConnected } = useConnection();
  const { mutateAsync: signMessageAsync } = useSignMessage();
  return useCallback(
    async (d: SignDetails): Promise<Proof> => {
      let current = isConnected && address ? address : null;
      if (!current) {
        // Just after a page load the wallet may still be reconnecting: wait for it (up to 3 s).
        if (getConnection(wagmiConfig).status === "disconnected") await reconnect(wagmiConfig).catch(() => {});
        for (let i = 0; i < 30 && ["connecting", "reconnecting"].includes(getConnection(wagmiConfig).status); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        const c = getConnection(wagmiConfig);
        current = c.status === "connected" && c.address ? c.address : null;
      }
      if (!current) {
        openWalletDialog();
        throw new ClientApiError(0, { code: "UNAUTHENTICATED", message: "Connect your admin wallet, then try again." });
      }
      if (expectedWallet && current.toLowerCase() !== expectedWallet.toLowerCase()) {
        throw new ClientApiError(0, {
          code: "UNAUTHENTICATED",
          message: `Switch your wallet to ${expectedWallet.slice(0, 6)}…${expectedWallet.slice(-4)} — the account you are signed in with.`,
        });
      }
      const c = await api<{ nonce: string; message: string }>("/api/admin/challenge", { method: "POST", body: d });
      try {
        const signature = await signMessageAsync({ message: c.message });
        return { nonce: c.nonce, signature };
      } catch {
        throw new ClientApiError(0, { code: "UNAUTHENTICATED", message: "Signature cancelled in your wallet." });
      }
    },
    [address, isConnected, expectedWallet, signMessageAsync],
  );
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
export const shortId = (id: string | null | undefined) => (id ? `${id.slice(0, 8)}…` : "—");
export const shortWallet = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
