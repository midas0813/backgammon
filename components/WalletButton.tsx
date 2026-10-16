"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { useMounted } from "@/lib/client/hooks";
import { useMe } from "@/lib/client/me";
import { openWalletDialog } from "@/lib/client/wallet";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const WalletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2" />
  </svg>
);

/**
 * The one sign-in control. Not signed in: opens the wallet dialog (connect → sign the free SIWE
 * message → signed in; the first sign-in creates the account). Signed in: the account chip.
 */
export default function WalletButton({
  label = "Connect Wallet",
  className = "btn sm primary",
  showAccount = true,
}: {
  label?: string;
  className?: string;
  showAccount?: boolean;
}) {
  const me = useMe();
  const mounted = useMounted();
  if (!mounted || !me) {
    return (
      <button className={className} disabled aria-hidden style={{ opacity: 0.5 }}>
        <WalletIcon /> {label}
      </button>
    );
  }
  if (!me.registered || !me.walletAddress) {
    return (
      <button className={className} onClick={openWalletDialog}>
        <WalletIcon /> {label}
      </button>
    );
  }
  if (!showAccount) return null;
  return (
    <Link className="btn sm wallet-chip" href="/profile#wallet" title={me.walletAddress}>
      <span className="wallet-dot" />
      <span className="mono">{shortAddress(me.walletAddress)}</span>
      <Avatar name={me.name} src={me.avatarUrl} size={24} />
    </Link>
  );
}
