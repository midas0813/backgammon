import Link from "next/link";
import Art from "@/components/Art";
import { Brand } from "@/components/BrandMark";

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <aside className="auth-art">
        <Art k="auth" priority />
        <div className="auth-art-overlay" />
        <div className="auth-art-copy">
          <p className="display">“Luck decides the roll. You decide the game.”</p>
        </div>
      </aside>
      <section className="auth-panel">
        <Link href="/" className="brand auth-brand">
          <Brand />
        </Link>
        <div className="auth-card">
          <h1 className="display">{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
