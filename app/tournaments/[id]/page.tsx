"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Bracket from "@/components/Bracket";
import { RewardList, StartsIn, TourneyTags } from "@/components/TournamentBits";
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
  const status =
    t.status === "COMPLETED"
      ? `🏆 ${t.winner}`
      : t.status === "RUNNING"
        ? "In progress"
        : t.status === "CANCELLED"
          ? "Cancelled"
          : `${t.registered}/${t.size} registered`;
  return (
    <main className="page">
      <Link className="lobby-back" href="/tournaments">
        ← Tournaments
      </Link>
      <section className="card">
        <TourneyTags t={t} />
        <div className="spread">
          <h1 style={{ fontSize: 24 }}>{t.name}</h1>
          <span className="badge">{status}</span>
        </div>
        {t.startsAt && t.status === "REGISTERING" && (
          <div className="small">
            Starts <StartsIn at={t.startsAt} />
          </div>
        )}
        {t.description && <p className="muted small">{t.description}</p>}
        {t.cancelReason && <p className="notice">{t.cancelReason}</p>}
        <Bracket t={t} />
      </section>
      <section className="card">
        <h2>{t.awards.length ? "Rewards given" : "Rewards"}</h2>
        {t.awards.length ? (
          <ul className="list">
            {t.awards.map((a) => (
              <li key={`${a.place}${a.name}`}>
                <span>
                  <strong>{a.place}</strong> · {a.name}
                  {a.me && " (you)"}
                </span>
                <span className="muted small">{[a.prize, a.xp && `${a.xp} XP`, a.credits && `${a.credits} credits`].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <RewardList rewards={t.rewards} />
        )}
      </section>
    </main>
  );
}
