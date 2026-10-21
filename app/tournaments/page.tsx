"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Bracket from "@/components/Bracket";
import GameIcon from "@/components/GameIcon";
import { RewardList, StartsIn, TourneyTags } from "@/components/TournamentBits";
import WalletButton from "@/components/WalletButton";
import { api, isHandled } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { toast } from "@/lib/client/toast";
import { BRAND } from "@/lib/brand";
import { GAMES, isGameType, type GameType } from "@/lib/games";
import type { TournamentList as Data } from "@/components/TournamentsCard";

type T = Data["open"][number];

/** Every game's tournaments, organised by the team: scheduled cups and events, sit & go tables, brackets, champions. */
export default function TournamentsPage() {
  const me = useMe();
  const [d, setD] = useState<Data | null>(null);
  const [game, setGame] = useState<GameType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/tournaments")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(() => {
    // Opened from a game's lobby: start on that game.
    const g = new URLSearchParams(window.location.search).get("game");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address on arrival
    if (isGameType(g)) setGame(g);
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
      else if (action === "register") toast("You're registered. We'll call you to the board when it starts.", { tone: "ok" });
      load();
    } catch (e) {
      if (!isHandled(e)) toast(e instanceof Error ? e.message : "Could not do that", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  };

  const pick = (list: T[]) => list.filter((t) => !game || t.game === game);
  const scheduled = d ? pick(d.open.filter((t) => t.kind !== "sitgo")) : [];
  const sitgo = d ? pick(d.open.filter((t) => t.kind === "sitgo")) : [];

  const joinButton = (t: T, label = "Register") =>
    t.joined ? (
      <button className="btn block" disabled={busy === t.id} onClick={() => act(t.id, "unregister")}>
        You&apos;re in · leave
      </button>
    ) : me && !me.registered ? (
      <WalletButton className="btn gold block" label="Connect a wallet to join" />
    ) : (
      <button className="btn primary block" disabled={busy === t.id || t.registered >= t.size} onClick={() => act(t.id, "register")}>
        {t.registered >= t.size ? "Full" : label}
      </button>
    );

  return (
    <main className="page">
      <Link className="lobby-back" href="/play">
        ← All games
      </Link>
      <section className="lobby-head">
        <div>
          <span className="eyebrow">{BRAND.name}</span>
          <h1 className="display">Tournaments</h1>
        </div>
      </section>
      <div className="seg compact" role="group" aria-label="Game">
        <button className="chip" aria-pressed={game === null} onClick={() => setGame(null)}>
          All games
        </button>
        {GAMES.map((g) => (
          <button key={g.id} className="chip" aria-pressed={game === g.id} onClick={() => setGame(g.id)}>
            <GameIcon name={g.id} size={15} /> {g.name}
          </button>
        ))}
      </div>
      <p className="muted small">
        Organised by the {BRAND.name} team: weekly and monthly cups, special events, and sit &amp; go tables that start the moment they&apos;re full. Entry is
        free with a wallet account. Matches are paired automatically and you&apos;re called to the board wherever you are in the app; the clock starts after a
        2-minute grace period. A drawn chess game goes to the player with Black.
      </p>
      {me && !me.registered && <p className="notice">Tournaments are for wallet accounts. Connect a wallet to join; guests can still play free games.</p>}
      {!d ? (
        <div className="skeleton" style={{ height: 240, borderRadius: 18 }} />
      ) : (
        <>
          <h2 className="section-title">Upcoming</h2>
          {scheduled.length === 0 ? (
            <p className="muted small">No cups open for registration right now. Weekly and monthly cups open a few days before they start.</p>
          ) : (
            <div className="tourney-list">
              {scheduled.map((t) => (
                <section key={t.id} className={`card tourney-card kind-${t.kind}`}>
                  <div className="spread" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <TourneyTags t={t} />
                      <h3 className="tourney-name">
                        <Link href={`/tournaments/${t.id}`}>{t.name}</Link>
                      </h3>
                      <div className="small">{t.startsAt && <StartsIn at={t.startsAt} />}</div>
                    </div>
                    <span className="tourney-count">
                      <strong>{t.registered}</strong>
                      <span className="muted small">/{t.size}</span>
                    </span>
                  </div>
                  {t.description && <p className="muted small">{t.description}</p>}
                  <RewardList rewards={t.rewards} />
                  <div className="muted small">Needs at least {t.minPlayers} players · the bracket is seeded by rating</div>
                  {joinButton(t)}
                </section>
              ))}
            </div>
          )}

          <h2 className="section-title">Sit &amp; go</h2>
          {sitgo.length === 0 ? (
            <p className="muted small">No sit &amp; go tables for this game right now.</p>
          ) : (
            <div className="tourney-grid">
              {sitgo.map((t) => (
                <section key={t.id} className="card tourney">
                  <TourneyTags t={t} />
                  <div className="spread">
                    <h3 className="tourney-name">{t.name}</h3>
                    <span className="badge">
                      {t.registered}/{t.size}
                    </span>
                  </div>
                  <div className="tourney-seats" aria-hidden>
                    {Array.from({ length: t.size }, (_, i) => (
                      <span key={i} className={i < t.registered ? "taken" : ""} />
                    ))}
                  </div>
                  <RewardList rewards={t.rewards} />
                  {joinButton(t, "Join")}
                </section>
              ))}
            </div>
          )}

          {pick(d.running).map((t) => (
            <section key={t.id} className="card">
              <div className="spread">
                <div>
                  <TourneyTags t={t} />
                  <h2>{t.name} · in progress</h2>
                </div>
                <Link className="btn sm" href={`/tournaments/${t.id}`}>
                  Open
                </Link>
              </div>
              <Bracket t={t} />
            </section>
          ))}
          {pick(d.finished).length > 0 && (
            <section className="card">
              <h2>Recent champions</h2>
              <ul className="list">
                {pick(d.finished).map((t) => (
                  <li key={t.id}>
                    <span>
                      <GameIcon name={t.game} size={15} className="inline-icon" /> 🏆 {t.winner}
                    </span>
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
