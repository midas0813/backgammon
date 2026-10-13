"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Avatar from "@/components/Avatar";
import { Brand } from "@/components/BrandMark";
import ConnectWalletButton from "@/components/ConnectWallet";
import { useMe } from "@/lib/client/me";

const APP_ROUTES = ["/play", "/wallet", "/profile"];

/** Sticky header for in-app pages. The landing page, auth pages and live games have their own chrome. */
export default function AppHeader() {
  const pathname = usePathname();
  const me = useMe();
  if (!APP_ROUTES.some((r) => pathname.startsWith(r))) return null;
  return (
    <header className="app-header">
      <div className="inner">
        <Link href="/" className="brand" aria-label="Home">
          <Brand />
        </Link>
        <nav className="header-actions">
          <Link className="btn sm ghost desktop-only" href="/play">
            Play
          </Link>
          <Link className="btn sm ghost desktop-only" href="/wallet">
            Wallet
          </Link>
          <ConnectWalletButton compact />
          {me?.registered ? (
            <Link href="/profile" aria-label="Your profile" style={{ display: "inline-flex" }}>
              <Avatar name={me.name} src={me.avatarUrl} size={38} />
            </Link>
          ) : (
            <Link className="btn sm primary" href="/login">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
