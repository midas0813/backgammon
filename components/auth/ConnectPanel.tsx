"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import WalletButton, { shortAddress } from "@/components/WalletButton";
import { useMe } from "@/lib/client/me";

const STEPS = [
  { title: "Connect your wallet", text: "MetaMask, Coinbase Wallet, Rabby or any browser wallet." },
  { title: "Sign one message", text: "Free and gasless — it only proves you own the address." },
  { title: "Pick a name and photo", text: "Your wallet is your account. No email, no password." },
];

export default function ConnectPanel() {
  const me = useMe();
  if (me?.registered && me.walletAddress) {
    return (
      <div className="connect-panel">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <Avatar name={me.name} src={me.avatarUrl} size={48} />
          <div style={{ minWidth: 0 }}>
            <strong>{me.name}</strong>
            <div className="muted small mono">{shortAddress(me.walletAddress)}</div>
          </div>
        </div>
        <Link className="btn primary lg block" href="/home">
          Continue
        </Link>
        <Link className="btn ghost block" href="/profile">
          View profile
        </Link>
      </div>
    );
  }
  return (
    <div className="connect-panel">
      <ol className="connect-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ animationDelay: `${120 + i * 110}ms` }}>
            <span className="n">{i + 1}</span>
            <span>
              <strong>{s.title}</strong>
              <span className="muted small" style={{ display: "block" }}>
                {s.text}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="connect-cta">
        <WalletButton className="btn primary lg block" label="Connect Wallet" />
      </div>
      <p className="muted small" style={{ textAlign: "center" }}>
        Playing as a guest? Your free games and practice credits move into your account when you sign in.
      </p>
      <Link className="btn ghost block" href="/home">
        Continue as guest
      </Link>
    </div>
  );
}
