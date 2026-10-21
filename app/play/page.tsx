"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Announcements from "@/components/Announcements";
import CountUp from "@/components/CountUp";
import { api } from "@/lib/client/api";
import { BRAND } from "@/lib/brand";
import { GAMES, UPCOMING_GAMES, lobbyPath, type GameType } from "@/lib/games";
import type { GamesHub } from "@/lib/server/hub";

/** Artwork per game (Chess shows animated pieces until its artwork arrives). */
const ART: Partial<Record<GameType, string>> = { backgammon: "/images/hero.webp" };

/** The Play tab: every game on the platform, live ones first, then what's coming. */
export default function PlayHub() {
  const [hub, setHub] = useState<GamesHub | null>(null);
  useEffect(() => {
    const load = () =>
      api<GamesHub>("/api/games")
        .then(setHub)
        .catch(() => {});
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main className="page hub">
      <Announcements />
      <section className="lobby-head">
        <div>
          <span className="eyebrow">{BRAND.name}</span>
          <h1 className="display">Choose a game</h1>
        </div>
        <div className="pulse-chips" aria-live="polite">
          <span className="pulse-chip">
            <span className="live-dot" aria-hidden />
            <CountUp value={hub?.online ?? 0} /> online
          </span>
        </div>
      </section>

      <section className="hub-games" aria-label="Games">
        {GAMES.map((g, i) => {
          const s = hub?.games.find((x) => x.id === g.id);
          return (
            <Link
              key={g.id}
              href={lobbyPath(g.id)}
              className={`hub-tile hub-${g.id} enter`}
              style={{ animationDelay: `${i * 70}ms` }}
              transitionTypes={["nav-forward"]}
            >
              {ART[g.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="hub-art" src={ART[g.id]} alt="" draggable={false} />
              ) : (
                <span className="hub-art hub-pieces" aria-hidden>
                  <span>♞</span>
                  <span>♛</span>
                  <span>♜</span>
                </span>
              )}
              <span className="hub-shade" aria-hidden />
              <span className="hub-text">
                <span className="hub-chips">
                  <span className="play-tile-badge">
                    <span className="live-dot" aria-hidden /> {s ? `${s.playing} playing` : "Live"}
                  </span>
                  {!!s?.open && <span className="play-tile-badge">{s.open} open</span>}
                </span>
                <strong>{g.name}</strong>
                <span>{g.tagline}</span>
                {s && (
                  <span className="hub-me">
                    Lv {s.level}
                    {s.rated ? ` · rating ${s.rating}` : ""}
                    <span className="hub-xp" aria-hidden>
                      <span style={{ width: `${Math.round((s.into / s.span) * 100)}%` }} />
                    </span>
                  </span>
                )}
              </span>
              <span className="hub-play" aria-hidden>
                Play
              </span>
            </Link>
          );
        })}
      </section>

      <h2 className="hub-soon-title">Coming soon</h2>
      <section className="hub-soon" aria-label="Coming soon">
        {UPCOMING_GAMES.map((g, i) => (
          <div key={g.id} className="hub-soon-tile enter" style={{ animationDelay: `${(GAMES.length + i) * 70}ms` }}>
            <span className="hub-soon-icon" aria-hidden>
              {g.icon}
            </span>
            <span>
              <strong>{g.name}</strong>
              <span className="muted small" style={{ display: "block" }}>
                {g.tagline}
              </span>
            </span>
            <span className="badge">Soon</span>
          </div>
        ))}
      </section>
    </main>
  );
}
