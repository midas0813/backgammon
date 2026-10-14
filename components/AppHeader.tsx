"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/BrandMark";
import WalletButton from "@/components/WalletButton";

const APP_ROUTES = ["/play", "/wallet", "/profile", "/welcome"];

/** Sticky header for in-app pages. The landing page, sign-in page and live games have their own chrome. */
export default function AppHeader() {
  const pathname = usePathname();
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
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}
