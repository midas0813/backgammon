"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Avatar from "@/components/Avatar";
import { useMe } from "@/lib/client/me";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const WalletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2" />
  </svg>
);

/**
 * The one sign-in control: RainbowKit's ConnectButton rendered in the site's style.
 * Connect → choose wallet → sign the SIWE message → signed in (account created on first sign-in).
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
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, authenticationStatus, mounted }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain && authenticationStatus === "authenticated";
        if (!ready) {
          return (
            <button className={className} disabled aria-hidden style={{ opacity: 0.5 }}>
              <WalletIcon /> {label}
            </button>
          );
        }
        if (!connected) {
          return (
            <button className={className} onClick={openConnectModal}>
              <WalletIcon /> {account && authenticationStatus === "unauthenticated" ? "Sign in" : label}
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button className="btn sm danger" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }
        if (!showAccount) return null;
        return (
          <button className="btn sm wallet-chip" onClick={openAccountModal} title={account.address}>
            {chain.hasIcon && chain.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chain.iconUrl} alt={chain.name ?? "network"} width={18} height={18} style={{ borderRadius: 9 }} />
            ) : (
              <span className="wallet-dot" />
            )}
            <span className="mono">{account.displayName}</span>
            {me && <Avatar name={me.name} src={me.avatarUrl} size={24} />}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
