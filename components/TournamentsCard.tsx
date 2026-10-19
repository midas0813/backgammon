"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { listTournaments } from "@/lib/server/tournaments";

export type TournamentList = Awaited<ReturnType<typeof listTournaments>>;

/** Open sit & go tables (and the one you're playing in) with a way into Tournaments (Home). */
export default function TournamentsCard() {
  const [d, setD] = useState<TournamentList | null>(null);
  useEffect(() => {
    const load = () =>
      api<TournamentList>("/api/tournaments")
        .then(setD)
        .catch(() => {});
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (!d) return null;
  const mine = d.running.find((t) => t.players.some((p) => p.me));
  return (
    <section className="card">
      <div className="spread">
        <h2>Tournaments</h2>
        <span className="badge">Free · sit &amp; go</span>
      </div>
      {mine && (
        <Link className="notice row" href={`/tournaments/${mine.id}`} style={{ justifyContent: "space-between" }}>
          <span>You&apos;re playing in {mine.name}</span>
          <span>Bracket →</span>
        </Link>
      )}
      <ul className="list">
        {d.open.map((t) => (
          <li key={t.id}>
            <span>
              <strong>{t.name}</strong>
              <span className="muted small">
                {" "}
                · {t.size} players · {t.points}-pt
              </span>
            </span>
            <span className="badge">{t.joined ? "You're in" : `${t.registered}/${t.size} joined`}</span>
          </li>
        ))}
      </ul>
      <Link className="btn primary block" href="/tournaments">
        See tournaments
      </Link>
    </section>
  );
}
