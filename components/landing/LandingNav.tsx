"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/BrandMark";
import WalletButton from "@/components/WalletButton";
import OpenAppLink from "./OpenAppLink";

export default function LandingNav() {
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
          <OpenAppLink className="btn sm ghost desktop-only" label="Play" />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
