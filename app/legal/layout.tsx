import Link from "next/link";

/** Shared frame for the legal pages. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page legal">
      {children}
      <nav className="row small">
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/cookies">Cookies</Link>
        <Link href="/">Home</Link>
      </nav>
    </main>
  );
}
