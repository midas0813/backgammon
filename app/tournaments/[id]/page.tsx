"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Bracket from "@/components/Bracket";
import { api } from "@/lib/client/api";
import type { TournamentView } from "@/lib/server/tournaments";

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t, setT] = useState<TournamentView | null>(null);
  useEffect(() => {
    const load = () =>
      api<TournamentView>(`/api/tournaments/${id}`)
        .then(setT)
        .catch(() => {});
    load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => window.clearInterval(timer);
  }, [id]);
  if (!t)
    return (
      <main className="page">
        <div className="skeleton" style={{ height: 300, borderRadius: 18 }} />
      </main>
    );
  return (
    <main className="page">
      <Link className="btn sm" href="/tournaments">
        ← Tournaments
      </Link>
      <section className="card">
        <div className="spread">
          <h1 style={{ fontSize: 24 }}>{t.name}</h1>
          <span className="badge">
            {t.status === "COMPLETED" ? `🏆 ${t.winner}` : t.status === "RUNNING" ? "In progress" : `${t.registered}/${t.size} joined`}
          </span>
        </div>
        <div className="muted small">
          {t.size} players · {t.points}-point matches
        </div>
        <Bracket t={t} />
      </section>
    </main>
  );
}
