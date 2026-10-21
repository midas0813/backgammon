"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSiweMessage } from "viem/siwe";
import { useConnect, useConnection, useConnectors, useDisconnect, useSignMessage } from "wagmi";
import { getConnection } from "wagmi/actions";
import Modal from "@/components/Modal";
import { BRAND } from "@/lib/brand";
import { useLatest } from "@/lib/client/hooks";
import { setMe, useMe, type Profile } from "@/lib/client/me";
import { appKit } from "@/lib/client/appkit";
import { chains, wagmiConfig } from "@/lib/client/wagmi";
import { closeWalletDialog, walletDialogStore } from "@/lib/client/wallet";

const STATEMENT = `Sign in to ${BRAND.name}. This free signature proves you own this wallet. It does not send a transaction, cost gas or move funds.`;

/** The invite code from the link the player arrived with (counted when their account is created). */
const savedInvite = () => {
  try {
    return localStorage.getItem("bg:invite") ?? undefined;
  } catch {
    return undefined;
  }
};

const inTenMinutes = () => new Date(Date.now() + 10 * 60 * 1000);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Step = { kind: "idle" } | { kind: "connecting"; name: string } | { kind: "signing" } | { kind: "error"; text: string };

/**
 * Connect a wallet and sign in with it (Sign-In with Ethereum). The wallet signs a short message —
 * free, no transaction — and the server checks it; the first sign-in with a wallet creates the account.
 * With a Reown project the wallet is chosen in AppKit's window and the signature is asked for as soon
 * as it connects; otherwise this dialog lists the wallets itself.
 */
export default function WalletDialog() {
  const open = useSyncExternalStore(walletDialogStore.subscribe, walletDialogStore.get, walletDialogStore.server);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const router = useRouter();
  const me = useMe();
  const connection = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const { mutateAsync: signMessage } = useSignMessage();
  const { disconnect } = useDisconnect();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  // Connected through AppKit just now: ask for the signature straight away (once).
  const [autoSign, setAutoSign] = useState(false);
  const autoSigned = useRef(false);

  // Wallets that announced themselves by name replace the generic "Injected" entry.
  const named = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  // MetaMask's app connector is only listed when the MetaMask extension isn't already there.
  const hasExtension = named.some((c) => c.id === "io.metamask");
  const list = [
    // The generic entry only when the browser has a wallet that didn't announce itself by name.
    ...(named.length ? named : connectors.filter((c) => c.id === "injected" && !!(window as { ethereum?: unknown }).ethereum)),
    ...connectors.filter((c) => c.type !== "injected" && !(c.type === "metaMask" && hasExtension)),
  ];

  const signIn = async (address: `0x${string}`, chainId: number | undefined) => {
    setStep({ kind: "signing" });
    try {
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      if (!nonceRes.ok) throw new Error((await nonceRes.json().catch(() => null))?.error?.message ?? "Could not start sign-in");
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: STATEMENT,
        uri: window.location.origin,
        version: "1",
        // Supported networks only; the signature itself does not depend on the wallet's network.
        chainId: chains.some((c) => c.id === chainId) ? chainId! : chains[0].id,
        nonce: await nonceRes.text(),
        issuedAt: new Date(),
        expirationTime: inTenMinutes(),
      });
      const signature = await signMessage({ message });
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, inviteCode: savedInvite() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "Sign-in failed");
      setMe((data as { profile: Profile }).profile);
      closeWalletDialog();
      // A new wallet is a new account: pick a name and photo first.
      if ((data as { isNew: boolean }).isNew) router.push("/welcome");
      else router.refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Sign-in failed";
      setStep({ kind: "error", text: /reject|denied|cancel/i.test(text) ? "The signature was cancelled in your wallet." : text });
    }
  };

  const choose = async (connector: (typeof connectors)[number]) => {
    setStep({ kind: "connecting", name: connector.name });
    try {
      const r = await connect({ connector });
      // Already signed in with this wallet (e.g. reconnecting to sign an admin action): just connect.
      if (me?.registered && me.walletAddress?.toLowerCase() === r.accounts[0].toLowerCase()) {
        closeWalletDialog();
        return;
      }
      await signIn(r.accounts[0], r.chainId);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not connect";
      setStep({ kind: "error", text: /reject|denied|cancel/i.test(text) ? "Connection cancelled in your wallet." : text.split("\n")[0] });
    }
  };

  // Opened only to connect the wallet you're already signed in with, and it is connected now: done.
  const alreadyYou = connection.status === "connected" && !!me?.registered && me.walletAddress?.toLowerCase() === connection.address?.toLowerCase();
  useEffect(() => {
    if (alreadyYou) closeWalletDialog();
  }, [alreadyYou]);

  const connected = connection.status === "connected" && !!connection.address;
  const signInRef = useLatest(signIn);
  useEffect(() => {
    if (!autoSign || !connected || alreadyYou || autoSigned.current) return;
    autoSigned.current = true;
    void signInRef.current(connection.address!, connection.chainId);
  }, [autoSign, connected, alreadyYou, connection.address, connection.chainId, signInRef]);

  if (appKit && !connected) {
    return (
      <AppKitConnect
        onOpen={() => {
          autoSigned.current = false;
          setAutoSign(true);
        }}
      />
    );
  }

  const busy = step.kind === "connecting" || step.kind === "signing";
  return (
    <Modal title="Connect a wallet" onClose={() => !busy && closeWalletDialog()}>
      <p className="muted small">
        Your wallet is your account. Signing in is a free signature — no transaction, no gas, no funds moved. By continuing you agree to the{" "}
        <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>

      {connection.status === "connected" && connection.address && (
        <div className="wallet-current">
          <span>
            Connected: <strong className="mono">{short(connection.address)}</strong>
          </span>
          <button className="btn primary block" disabled={busy} onClick={() => signIn(connection.address!, connection.chainId)}>
            {step.kind === "signing" ? "Check your wallet…" : "Sign in with this wallet"}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={() => disconnect()}>
            Use a different wallet
          </button>
        </div>
      )}

      {connection.status !== "connected" && (
        <ul className="wallet-list">
          {list.map((c) => (
            <li key={c.uid}>
              <button className="wallet-option" disabled={busy} onClick={() => choose(c)}>
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" width={28} height={28} />
                ) : (
                  <span className="wallet-option-icon" aria-hidden>
                    {c.name.slice(0, 1)}
                  </span>
                )}
                <span>{c.id === "injected" ? "Browser wallet" : c.type === "metaMask" ? "MetaMask app" : c.name}</span>
                {step.kind === "connecting" && step.name === c.name && <span className="muted small">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {step.kind === "signing" && connection.status !== "connected" && <p className="small">Check your wallet to sign the message…</p>}
      {step.kind === "error" && <p className="err small">{step.text}</p>}
      {!appKit && named.length === 0 && (
        <p className="muted small">
          On a phone, open this site in your wallet app&apos;s browser (MetaMask, Coinbase Wallet, Trust…), or install a browser wallet such as MetaMask.
        </p>
      )}
      <button className="btn block" disabled={busy} onClick={() => closeWalletDialog()}>
        Cancel
      </button>
    </Modal>
  );
}

/** Opens AppKit's wallet window; closing it without connecting a wallet closes the dialog too. */
function AppKitConnect({ onOpen }: { onOpen: () => void }) {
  const onOpenRef = useLatest(onOpen);
  useEffect(() => {
    if (!appKit) return;
    const kit = appKit;
    onOpenRef.current();
    void kit.open({ view: "Connect" });
    let wasOpen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = kit.subscribeState((s) => {
      if (s.open) wasOpen = true;
      else if (wasOpen) {
        // The connection settles a moment after the window closes.
        timer = setTimeout(() => {
          if (getConnection(wagmiConfig).status === "disconnected") closeWalletDialog();
        }, 600);
      }
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [onOpenRef]);
  return null;
}
