"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/home", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/play", label: "Play", icon: "M8 5v14l11-7z" },
  { href: "/leaderboard", label: "Ranks", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" },
  { href: "/wallet", label: "Wallet", icon: "M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2" },
  { href: "/profile", label: "Profile", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1-4 4-6 8-6s7 2 8 6" },
];
const SHOWN_ON = ["/home", "/play", "/leaderboard", "/wallet", "/profile"];

/** Bottom tabs for in-app pages; hidden on the landing page, auth pages and during live play. */
export default function BottomNav() {
  const pathname = usePathname();
  if (!SHOWN_ON.some((p) => pathname.startsWith(p))) return null;
  return (
    <nav className="tabs" aria-label="Main" style={{ viewTransitionName: "app-tabs" }}>
      {TABS.map((t, i) => {
        const active = pathname.startsWith(t.href);
        const here = TABS.findIndex((x) => pathname.startsWith(x.href));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            transitionTypes={here === -1 || active ? undefined : [i > here ? "nav-forward" : "nav-back"]}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
