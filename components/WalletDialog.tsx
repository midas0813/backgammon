"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createSiweMessage } from "viem/siwe";
import { useConnect, useConnection, useConnectors, useDisconnect, useSignMessage } from "wagmi";
import { BrandMark } from "@/components/BrandMark";
import { BRAND } from "@/lib/brand";
import { useLatest } from "@/lib/client/hooks";
import { setMe, useMe, type Profile } from "@/lib/client/me";
import { chains } from "@/lib/client/wagmi";
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
const RECENT_KEY = "bg:lastWallet";
const recentWallet = () => {
  try {
    return localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
};
const rememberWallet = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, id);
  } catch {
    // Private mode: nothing to remember.
  }
};

const inTenMinutes = () => new Date(Date.now() + 10 * 60 * 1000);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const cancelled = (text: string) => /reject|denied|cancel/i.test(text);

/**
 * Popular wallets: on a phone without a wallet browser they open this site inside the wallet app
 * (where the wallet is built in); on a computer without the extension they link to its download.
 */
const enc = encodeURIComponent;
const CATALOG: { id: string; rdns: string; name: string; icon: string; get: string; open?: (url: string) => string }[] = [
  {
    id: "metamask",
    rdns: "io.metamask",
    name: "MetaMask",
    icon: "/wallets/metamask.svg",
    get: "https://metamask.io/download/",
    open: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "trust",
    rdns: "com.trustwallet.app",
    name: "Trust Wallet",
    icon: "/wallets/trust.svg",
    get: "https://trustwallet.com/download",
    open: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${enc(u)}`,
  },
  {
    id: "coinbase",
    rdns: "com.coinbase.wallet",
    name: "Coinbase Wallet",
    icon: "/wallets/coinbase.svg",
    get: "https://www.coinbase.com/wallet/downloads",
    open: (u) => `https://go.cb-w.com/dapp?cb_url=${enc(u)}`,
  },
  {
    id: "okx",
    rdns: "com.okex.wallet",
    name: "OKX Wallet",
    icon: "/wallets/okx.svg",
    get: "https://www.okx.com/web3",
    open: (u) => `https://www.okx.com/download?deeplink=${enc(`okx://wallet/dapp/url?dappUrl=${enc(u)}`)}`,
  },
  {
    id: "phantom",
    rdns: "app.phantom",
    name: "Phantom",
    icon: "/wallets/phantom.svg",
    get: "https://phantom.com/download",
    open: (u) => `https://phantom.app/ul/browse/${enc(u)}?ref=${enc(new URL(u).origin)}`,
  },
];

type Connector = ReturnType<typeof useConnectors>[number];
type Shown = { name: string; icon?: string };
type View =
  | { kind: "list" }
  | { kind: "connecting"; connector: Connector; failed?: string }
  | { kind: "sign"; wallet: Shown; failed?: string; signing?: boolean }
  | { kind: "missing"; wallet: (typeof CATALOG)[number] }
  | { kind: "about" }
  | { kind: "get" };

/**
 * Connect a wallet and sign in with it (Sign-In with Ethereum), in a window laid out like Reown
 * AppKit's, without QR codes: browser wallets connect directly, and on a phone the wallet apps open
 * this site in their own browser. The wallet signs a short message (free, no transaction) and the
 * server checks it; the first sign-in with a wallet creates the account.
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
  const connected = connection.status === "connected" && !!connection.address;
  const current: Shown = { name: connection.connector?.name ?? "your wallet", icon: connection.connector?.icon };
  const [view, setView] = useState<View>(() => (connected ? { kind: "sign", wallet: current } : { kind: "list" }));
  const [phone] = useState(isPhone);
  const [recent] = useState(recentWallet);
  const signingNow = useRef(false);

  // Wallets that announced themselves by name replace the generic "Injected" entry.
  const named = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const installed = named.length
    ? named
    : connectors.filter((c) => c.id === "injected" && typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum);
  const installedIds = new Set(installed.map((c) => c.id));
  const others = CATALOG.filter((w) => !installedIds.has(w.rdns) && (!phone || w.open));
  const ordered = [...installed].sort((a, b) => Number(b.id === recent) - Number(a.id === recent));

  const close = () => {
    if (view.kind === "sign" && view.signing) return;
    closeWalletDialog();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && closeWalletDialog();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const signIn = async (address: `0x${string}`, chainId: number | undefined, wallet: Shown) => {
    if (signingNow.current) return;
    signingNow.current = true;
    setView({ kind: "sign", wallet, signing: true });
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
      setView({ kind: "sign", wallet, failed: cancelled(text) ? "You cancelled the signature in your wallet." : text.split("\n")[0] });
    } finally {
      signingNow.current = false;
    }
  };
  const signInRef = useLatest(signIn);

  const choose = async (connector: Connector) => {
    setView({ kind: "connecting", connector });
    try {
      const r = await connect({ connector });
      rememberWallet(connector.id);
      // Already signed in with this wallet (e.g. reconnecting to sign an admin action): just connect.
      if (me?.registered && me.walletAddress?.toLowerCase() === r.accounts[0].toLowerCase()) {
        closeWalletDialog();
        return;
      }
      await signInRef.current(r.accounts[0], r.chainId, { name: connector.name, icon: connector.icon });
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not connect";
      setView({ kind: "connecting", connector, failed: cancelled(text) ? "Connection declined" : text.split("\n")[0] });
    }
  };

  const openInApp = (w: (typeof CATALOG)[number]) => {
    rememberWallet(w.rdns);
    window.location.assign(w.open!(window.location.href));
  };

  // Opened only to connect the wallet you're already signed in with, and it is connected now: done.
  const alreadyYou = connected && !!me?.registered && me.walletAddress?.toLowerCase() === connection.address?.toLowerCase();
  useEffect(() => {
    if (alreadyYou) closeWalletDialog();
  }, [alreadyYou]);

  const back: View | null = view.kind === "get" ? { kind: "about" } : view.kind === "list" || view.kind === "sign" ? null : { kind: "list" };
  const title =
    view.kind === "list"
      ? "Connect Wallet"
      : view.kind === "connecting"
        ? view.connector.name
        : view.kind === "sign"
          ? "Sign In"
          : view.kind === "missing"
            ? view.wallet.name
            : view.kind === "about"
              ? "What is a wallet?"
              : "Get a wallet";

  return createPortal(
    <div className="wk-backdrop" onClick={close}>
      <div className="wk" role="dialog" aria-modal="true" aria-label="Connect Wallet" onClick={(e) => e.stopPropagation()}>
        <header className="wk-head">
          {back ? (
            <button className="wk-icon-btn" aria-label="Back" onClick={() => setView(back)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          ) : view.kind !== "list" ? (
            <span className="wk-icon-btn" aria-hidden />
          ) : (
            <button className="wk-icon-btn" aria-label="What is a wallet?" onClick={() => setView({ kind: "about" })}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2.1-2.4 3.6M12 17h.01" />
              </svg>
            </button>
          )}
          <h2>{title}</h2>
          <button className="wk-icon-btn" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="wk-body" key={view.kind}>
          {view.kind === "list" && (
            <>
              <ul className="wk-list">
                {ordered.map((c) => (
                  <li key={c.uid}>
                    <button className="wk-row" onClick={() => choose(c)}>
                      <WalletIcon src={c.icon ?? CATALOG.find((w) => w.rdns === c.id)?.icon} name={c.name} />
                      <span className="wk-row-name">{c.id === "injected" ? "Browser Wallet" : c.name}</span>
                      <span className={`wk-tag${c.id === recent ? " recent" : ""}`}>{c.id === recent ? "Recent" : "Installed"}</span>
                    </button>
                  </li>
                ))}
                {others.map((w) => (
                  <li key={w.id}>
                    <button className="wk-row" onClick={() => (phone ? openInApp(w) : setView({ kind: "missing", wallet: w }))}>
                      <WalletIcon src={w.icon} name={w.name} />
                      <span className="wk-row-name">{w.name}</span>
                      {phone && <span className="wk-tag muted">Open app</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="wk-foot">
                <span>Haven&apos;t got a wallet?</span>
                <button className="wk-pill" onClick={() => setView({ kind: "about" })}>
                  Get started
                </button>
              </div>
            </>
          )}

          {view.kind === "connecting" && (
            <div className="wk-center">
              <Spinner
                icon={view.connector.icon ?? CATALOG.find((w) => w.rdns === view.connector.id)?.icon}
                name={view.connector.name}
                failed={!!view.failed}
              />
              <strong className="wk-big">{view.failed ? view.failed : `Continue in ${view.connector.name}`}</strong>
              <p className="wk-muted">
                {view.failed
                  ? "The request can be declined if another one is still open in your wallet. Check it, then try again."
                  : "Accept the connection request in your wallet."}
              </p>
              {view.failed && (
                <button className="wk-btn" onClick={() => choose(view.connector)}>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
                  </svg>
                  Try again
                </button>
              )}
            </div>
          )}

          {view.kind === "sign" && (
            <div className="wk-center">
              <div className="wk-pair" aria-hidden>
                <span className="wk-pair-app">
                  <BrandMark size={44} />
                </span>
                <span className="wk-pair-wallet">
                  <WalletIcon src={view.wallet.icon} name={view.wallet.name} size={44} />
                </span>
              </div>
              <strong className="wk-big">{BRAND.name} needs to connect to your wallet</strong>
              <p className="wk-muted">
                Sign this message to prove you own this wallet and proceed. It&apos;s free: no transaction, no gas, no funds moved. Cancelling will disconnect
                you.
              </p>
              {connection.address && <span className="wk-address mono">{short(connection.address)}</span>}
              {view.failed && <p className="wk-error">{view.failed}</p>}
              <div className="wk-actions">
                <button
                  className="wk-btn ghost"
                  disabled={view.signing}
                  onClick={() => {
                    disconnect();
                    closeWalletDialog();
                  }}
                >
                  Cancel
                </button>
                <button
                  className="wk-btn primary"
                  disabled={view.signing || !connection.address}
                  onClick={() => signIn(connection.address!, connection.chainId, view.wallet)}
                >
                  {view.signing ? "Signing…" : "Sign"}
                </button>
              </div>
              {!view.signing && (
                <button
                  className="wk-link"
                  onClick={() => {
                    disconnect();
                    setView({ kind: "list" });
                  }}
                >
                  Use a different wallet
                </button>
              )}
            </div>
          )}

          {view.kind === "missing" && (
            <div className="wk-center">
              <WalletIcon src={view.wallet.icon} name={view.wallet.name} size={72} />
              <strong className="wk-big">{view.wallet.name} isn&apos;t installed</strong>
              <p className="wk-muted">
                Add the {view.wallet.name} extension to this browser, then reload this page. On a phone, open this site from the wallet app.
              </p>
              <a className="wk-btn primary" href={view.wallet.get} target="_blank" rel="noopener noreferrer">
                Get {view.wallet.name}
              </a>
              <button className="wk-link" onClick={() => window.location.reload()}>
                I&apos;ve installed it, reload
              </button>
            </div>
          )}

          {view.kind === "about" && (
            <div className="wk-center">
              <div className="wk-about">
                {[
                  ["M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2", "Your digital wallet", "A wallet app holds your crypto and lets you sign in to apps like this one."],
                  [
                    "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z",
                    "Your account here",
                    "No email or password: your wallet address is your account, on any device.",
                  ],
                  ["M20 6L9 17l-5-5", "Free to sign in", "Signing in is one free signature. It never sends a transaction or moves funds."],
                ].map(([d, t, s]) => (
                  <div key={t} className="wk-about-row">
                    <span className="wk-about-icon" aria-hidden>
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={d} />
                      </svg>
                    </span>
                    <span>
                      <strong>{t}</strong>
                      <span className="wk-muted">{s}</span>
                    </span>
                  </div>
                ))}
              </div>
              <button className="wk-btn primary" onClick={() => setView({ kind: "get" })}>
                Get a wallet
              </button>
            </div>
          )}

          {view.kind === "get" && (
            <ul className="wk-list">
              {CATALOG.map((w) => (
                <li key={w.id}>
                  <a className="wk-row" href={w.get} target="_blank" rel="noopener noreferrer">
                    <WalletIcon src={w.icon} name={w.name} />
                    <span className="wk-row-name">{w.name}</span>
                    <span className="wk-tag">Get</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="wk-legal">
          By connecting your wallet, you agree to our <Link href="/legal/terms">Terms of Service</Link> and <Link href="/legal/privacy">Privacy Policy</Link>.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function WalletIcon({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="wk-wicon" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="wk-wicon wk-wicon-letter" style={{ width: size, height: size }} aria-hidden>
      {name.slice(0, 1)}
    </span>
  );
}

/** The wallet's icon inside a spinning ring while the wallet is asked; the ring turns red if declined. */
function Spinner({ icon, name, failed }: { icon?: string; name: string; failed: boolean }) {
  return (
    <span className={`wk-spinner${failed ? " failed" : ""}`}>
      <svg viewBox="0 0 110 110" aria-hidden>
        <rect x="3" y="3" width="104" height="104" rx="30" pathLength="100" />
      </svg>
      <WalletIcon src={icon} name={name} size={72} />
    </span>
  );
}
