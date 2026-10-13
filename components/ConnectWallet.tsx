"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { ClientApiError, api } from "@/lib/client/api";
import { refreshMe, useMe } from "@/lib/client/me";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const CHAINS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  11155111: "Sepolia",
  84532: "Base Sepolia",
};

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const chainName = (id: number) => CHAINS[id] ?? (id ? `Chain ${id}` : "Unknown network");

function toHex(text: string) {
  return "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Step = "idle" | "connecting" | "signing" | "verifying";

/** Hook: connect an injected browser wallet and prove ownership with a gas-free signature. */
export function useConnectWallet() {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [noWallet, setNoWallet] = useState(false);

  const connect = async () => {
    setError(null);
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth) {
      setNoWallet(true);
      return false;
    }
    try {
      setStep("connecting");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account selected");
      const chainId = parseInt(String(await eth.request({ method: "eth_chainId" })), 16);
      const { message } = await api<{ message: string }>("/api/wallet/connect/challenge", {
        method: "POST",
        body: { address, chainId },
      });
      setStep("signing");
      const signature = await eth.request({ method: "personal_sign", params: [toHex(message), address] });
      setStep("verifying");
      await api("/api/wallet/connect/verify", { method: "POST", body: { address, signature, chainId } });
      await refreshMe();
      setStep("idle");
      return true;
    } catch (e) {
      setStep("idle");
      const err = e as { code?: number; message?: string };
      if (err.code === 4001) setError("Request cancelled in your wallet.");
      else if (e instanceof ClientApiError) setError(e.message);
      else setError(err.message ?? "Could not connect the wallet");
      return false;
    }
  };

  return { connect, step, error, noWallet, closeNoWallet: () => setNoWallet(false) };
}

const STEP_LABEL: Record<Step, string> = {
  idle: "Connect Wallet",
  connecting: "Opening wallet…",
  signing: "Sign in your wallet…",
  verifying: "Verifying…",
};

export function NoWalletModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="No browser wallet found" onClose={onClose}>
      <p className="muted">
        Connect Wallet works with a browser wallet such as MetaMask, Coinbase Wallet or Rabby. On a phone, open this site inside your
        wallet app&apos;s built-in browser.
      </p>
      <div className="grid2">
        <a className="btn" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          Get MetaMask
        </a>
        <a className="btn" href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noreferrer">
          Coinbase Wallet
        </a>
      </div>
      <p className="muted small">QR-code connection via WalletConnect needs a WalletConnect project ID and is not set up yet.</p>
      <button className="btn block" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}

/** Header/landing button. Shows the linked address once connected. */
export default function ConnectWalletButton({ className = "btn sm", compact = false }: { className?: string; compact?: boolean }) {
  const me = useMe();
  const { connect, step, error, noWallet, closeNoWallet } = useConnectWallet();
  const linked = me?.wallets?.[0];
  if (linked) {
    return (
      <a className={className} href="/profile#wallets" title={`${linked.address} · ${chainName(linked.chainId)}`}>
        <span className="wallet-dot" aria-hidden />
        {shortAddress(linked.address)}
      </a>
    );
  }
  return (
    <>
      <button className={className} onClick={connect} disabled={step !== "idle"} title={error ?? undefined}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <path d="M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2" />
        </svg>
        {compact && step === "idle" ? "Connect" : STEP_LABEL[step]}
      </button>
      {error && step === "idle" && !compact && <span className="err small">{error}</span>}
      {noWallet && <NoWalletModal onClose={closeNoWallet} />}
    </>
  );
}
