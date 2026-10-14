"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ClientApiError, api } from "./api";

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
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  return useCallback(
    async (d: SignDetails): Promise<Proof> => {
      if (!isConnected || !address) {
        openConnectModal?.();
        throw new ClientApiError(0, { code: "UNAUTHENTICATED", message: "Connect your admin wallet, then try again." });
      }
      if (expectedWallet && address.toLowerCase() !== expectedWallet.toLowerCase()) {
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
    [address, isConnected, expectedWallet, openConnectModal, signMessageAsync],
  );
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const shortId = (id: string | null | undefined) => (id ? `${id.slice(0, 8)}…` : "—");
export const shortWallet = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
