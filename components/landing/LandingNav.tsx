"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { Brand } from "@/components/BrandMark";
import ConnectWalletButton from "@/components/ConnectWallet";
import { useMe } from "@/lib/client/me";

export default function LandingNav() {
  const me = useMe();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`l-nav${scrolled ? " scrolled" : ""}`}>
      <div className="l-nav-inner">
        <Link href="/" className="brand" aria-label="Home">
          <Brand />
        </Link>
        <nav className="l-links desktop-only" aria-label="Sections">
          <a href="#about">About</a>
          <a href="#how">How to play</a>
          <a href="#boards">Boards</a>
          <a href="#modes">Modes</a>
        </nav>
        <div className="header-actions">
          <span className="desktop-only">
            <ConnectWalletButton compact className="btn sm ghost" />
          </span>
          {me?.registered ? (
            <Link href="/profile" aria-label="Your profile" style={{ display: "inline-flex" }}>
              <Avatar name={me.name} src={me.avatarUrl} size={38} />
            </Link>
          ) : (
            <>
              <Link className="btn sm ghost" href="/login">
                Sign in
              </Link>
              <Link className="btn sm primary" href="/signup">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
