"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import GameIcon from "@/components/GameIcon";
import { fmtStart } from "@/components/TournamentBits";
import { api } from "@/lib/client/api";
import { KIND_LABEL } from "@/lib/tournaments";
import type { listTournaments } from "@/lib/server/tournaments";

export type TournamentList = Awaited<ReturnType<typeof listTournaments>>;

/** The next tournaments in every game (and the one you're playing in), with a way into Tournaments (Home). */
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
  // Scheduled cups first (soonest first), then one sit & go table per game.
  const sitgo = d.open.filter((t) => t.kind === "sitgo").filter((t, i, all) => all.findIndex((x) => x.game === t.game) === i);
  const shown = [...d.open.filter((t) => t.kind !== "sitgo"), ...sitgo].slice(0, 4);
  return (
    <section className="card">
      <div className="spread">
        <h2>Tournaments</h2>
        <span className="badge">Free entry</span>
      </div>
      {mine && (
        <Link className="notice row" href={`/tournaments/${mine.id}`} style={{ justifyContent: "space-between" }}>
          <span>You&apos;re playing in {mine.name}</span>
          <span>Bracket →</span>
        </Link>
      )}
      {shown.length === 0 ? (
        <p className="muted small">The next cups will be announced soon.</p>
      ) : (
        <ul className="list">
          {shown.map((t) => (
            <li key={t.id}>
              <Link href={`/tournaments/${t.id}`} className="tourney-line">
                <span className="tourney-line-icon" aria-hidden>
                  <GameIcon name={t.game} size={18} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong className="ellipsis" style={{ display: "block" }}>
                    {t.name}
                  </strong>
                  <span className="muted small">
                    {KIND_LABEL[t.kind]} · {t.startsAt ? fmtStart(t.startsAt) : "starts when full"}
                  </span>
                </span>
              </Link>
              <span className="badge">{t.joined ? "You're in" : `${t.registered}/${t.size}`}</span>
            </li>
          ))}
        </ul>
      )}
      <Link className="btn primary block" href="/tournaments">
        See all tournaments
      </Link>
    </section>
  );
}
