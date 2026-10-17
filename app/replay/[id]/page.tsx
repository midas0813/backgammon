"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Board from "@/components/Board";
import { api } from "@/lib/client/api";
import { framesFromEvents } from "@/lib/client/replayFrames";
import { useTheme } from "@/lib/client/theme";
import type { MatchSnapshot } from "@/lib/server/matches";

type History = { events: { type: string; payload: Record<string, unknown> }[] };

/** Step through a match move by move (players, and spectators where watching is allowed). */
export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const theme = useTheme();
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const [events, setEvents] = useState<History["events"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [nav, setNav] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    Promise.all([api<MatchSnapshot>(`/api/matches/${id}`), api<History>(`/api/matches/${id}/history?cursor=0`)])
      .then(([s, h]) => {
        setSnap(s);
        setEvents(h.events);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this match"));
  }, [id]);

  const names = useMemo<[string, string]>(() => (snap ? [snap.seats[0].name, snap.seats[1].name] : ["White", "Black"]), [snap]);
  const frames = useMemo(() => (events ? framesFromEvents(events, names) : []), [events, names]);
  const go = (n: number) => {
    setI(Math.max(0, Math.min(frames.length - 1, n)));
    setNav((x) => x + 1);
  };

  // Autoplay steps forward and simply stops at the end.
  const running = playing && i < frames.length - 1;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => {
      setI((x) => Math.min(frames.length - 1, x + 1));
      setNav((x) => x + 1);
    }, 1100);
    return () => window.clearTimeout(t);
  }, [running, i, frames.length]);

  if (error) {
    return (
      <main className="page">
        <p className="err">{error}</p>
        <Link className="btn" href="/play">
          ← Lobby
        </Link>
      </main>
    );
  }
  if (!snap || !events)
    return (
      <main className="page">
        <div className="skeleton" style={{ height: 360, borderRadius: 18 }} />
      </main>
    );
  const f = frames[i];
  return (
    <main className="game replay">
      <div className="topbar">
        <Link className="btn sm" href={`/match/${id}`}>
          ← Match
        </Link>
        <div className="info">
          Replay · {names[0]} vs {names[1]} · {snap.targetPoints}-pt
        </div>
        <span />
      </div>
      {f ? (
        <>
          <div className="board-wrap">
            <Board
              board={f.board}
              viewer={0}
              theme={theme}
              dice={f.dice ? f.dice.map((v) => ({ value: v, used: false })) : null}
              diceOwner={f.diceSeat === 1 ? "opponent" : "viewer"}
              cube={{ value: f.cube, owner: f.cubeOwner === null ? null : f.cubeOwner === 0 ? "viewer" : "opponent", disabled: false }}
              selectable={new Set()}
              selected={null}
              targets={new Map()}
              anim={f.moves.length ? { key: `r${i}-${nav}`, moves: f.moves } : null}
            />
          </div>
          <div className="replay-caption" aria-live="polite">
            <span className="muted small">
              Game {f.game} · score {f.score[0]}–{f.score[1]} · step {i + 1}/{frames.length}
            </span>
            <strong>{f.caption}</strong>
          </div>
          <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => go(Number(e.target.value))} aria-label="Position in the match" />
          <div className="replay-controls">
            <button className="btn" onClick={() => go(0)} aria-label="Start">
              ⏮
            </button>
            <button className="btn" onClick={() => go(i - 1)} aria-label="Back one step">
              ◀
            </button>
            <button className="btn primary" onClick={() => (running ? setPlaying(false) : (i >= frames.length - 1 && go(0), setPlaying(true)))}>
              {running ? "Pause" : "Play"}
            </button>
            <button className="btn" onClick={() => go(i + 1)} aria-label="Forward one step">
              ▶
            </button>
            <button className="btn" onClick={() => go(frames.length - 1)} aria-label="End">
              ⏭
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Nothing to replay yet.</p>
      )}
    </main>
  );
}
