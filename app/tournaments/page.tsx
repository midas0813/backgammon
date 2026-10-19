"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Bracket from "@/components/Bracket";
import WalletButton from "@/components/WalletButton";
import { api, isHandled } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { toast } from "@/lib/client/toast";
import type { TournamentList as Data } from "@/components/TournamentsCard";

/** Sit & go tournaments: join a table, it starts when full. */
export default function TournamentsPage() {
  const me = useMe();
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/tournaments")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);
  const act = async (id: string, action: "register" | "unregister") => {
    setBusy(id);
    try {
      const r = await api<{ status: string }>(`/api/tournaments/${id}`, { method: "POST", body: { action } });
      if (r.status === "RUNNING") toast("The tournament is full and starting — your first match is ready!", { tone: "ok" });
      load();
    } catch (e) {
      if (!isHandled(e)) toast(e instanceof Error ? e.message : "Could not do that", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="page">
      <Link className="btn sm" href="/play" style={{ alignSelf: "flex-start" }}>
        ← Lobby
      </Link>
      <section className="lobby-head">
        <div>
          <span className="eyebrow">Free</span>
          <h1 className="display">Tournaments</h1>
        </div>
      </section>
      <p className="muted small">
        Sit &amp; go: each table starts the moment it&apos;s full. Matches are paired automatically and you&apos;re called to the board wherever you are in the
        app; the clock starts after a 2-minute grace period. The champion earns 200 XP, the runner-up 100.
      </p>
      {me && !me.registered && <p className="notice">Tournaments are for wallet accounts. Connect a wallet to join; guests can still play free games.</p>}
      {!d ? (
        <div className="skeleton" style={{ height: 240, borderRadius: 18 }} />
      ) : (
        <>
          <div className="tourney-grid">
            {d.open.map((t) => (
              <section key={t.id} className="card tourney">
                <div className="spread">
                  <h2>{t.name}</h2>
                  <span className="badge">
                    {t.registered}/{t.size}
                  </span>
                </div>
                <div className="muted small">
                  {t.size} players · {t.points}-point matches · {t.clock === "fast" ? "fast clock" : t.clock === "none" ? "no clock" : "standard clock"}
                </div>
                <div className="tourney-seats" aria-hidden>
                  {Array.from({ length: t.size }, (_, i) => (
                    <span key={i} className={i < t.registered ? "taken" : ""} />
                  ))}
                </div>
                {t.joined ? (
                  <button className="btn block" disabled={busy === t.id} onClick={() => act(t.id, "unregister")}>
                    You&apos;re in · leave
                  </button>
                ) : me && !me.registered ? (
                  <WalletButton className="btn gold block" label="Connect a wallet to join" />
                ) : (
                  <button className="btn primary block" disabled={busy === t.id} onClick={() => act(t.id, "register")}>
                    Join
                  </button>
                )}
              </section>
            ))}
          </div>
          {d.running.map((t) => (
            <section key={t.id} className="card">
              <div className="spread">
                <h2>{t.name} · in progress</h2>
                <Link className="btn sm" href={`/tournaments/${t.id}`}>
                  Open
                </Link>
              </div>
              <Bracket t={t} />
            </section>
          ))}
          {d.finished.length > 0 && (
            <section className="card">
              <h2>Recent champions</h2>
              <ul className="list">
                {d.finished.map((t) => (
                  <li key={t.id}>
                    <span>🏆 {t.winner}</span>
                    <Link className="muted small" href={`/tournaments/${t.id}`}>
                      {t.name} · bracket
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
