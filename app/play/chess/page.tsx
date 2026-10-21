"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Announcements from "@/components/Announcements";
import CountUp from "@/components/CountUp";
import Modal from "@/components/Modal";
import PlayTile from "@/components/PlayTile";
import RoomBrowser, { type RoomView } from "@/components/RoomBrowser";
import { ClientApiError, api, isHandled } from "@/lib/client/api";
import { watchTable, unwatchTable } from "@/lib/client/tables";
import { toast } from "@/lib/client/toast";
import { TIME_CONTROLS } from "@/lib/chess/rules";
import type { Lobby, PublicTables } from "@/lib/server/lobby";

type Poll = Lobby | { unchanged: true; version: string };
type Color = "random" | "white" | "black";

const POLL_MS = 4000;
const MODE_LABEL: Record<string, string> = { quick: "Public table", private: "Invite", local: "Pass & play", bot: "vs Computer" };
const LEVELS = [
  { id: 1, label: "Easy" },
  { id: 2, label: "Medium" },
  { id: 3, label: "Hard" },
];

/** The chess lobby: quick match by time control, open tables, the computer and pass & play. */
export default function ChessLobbyPage() {
  const router = useRouter();
  const [data, setData] = useState<Lobby | null>(null);
  const [tc, setTc] = useState<string>("5+0");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [computer, setComputer] = useState(false);
  const [browsing, setBrowsing] = useState<RoomView | null>(null);
  const versionRef = useRef<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const v = !force && versionRef.current ? `&v=${versionRef.current}` : "";
      const d = await api<Poll>(`/api/lobby?game=chess${v}`);
      if ("unchanged" in d) return;
      versionRef.current = d.version;
      setData(d);
      for (const m of d.mine) if (m.host && m.status === "WAITING" && m.mode !== "local") watchTable(m.matchId);
    } catch {}
  }, []);

  useEffect(() => {
    load(true);
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const go = async (key: string, fn: () => Promise<{ matchId: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      router.push(`/match/${r.matchId}`);
    } catch (e) {
      if (isHandled(e)) {
        // Explained app-wide (one game at a time).
      } else if (e instanceof ClientApiError && e.code === "EVENT_FULL") {
        toast("Someone just took that seat — try another table.", { tone: "warn" });
      } else {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        if (browsing) toast(msg, { tone: "warn" });
        else setError(msg);
      }
      setBusy(null);
    }
  };

  const join = (id: string) => go(`join:${id}`, () => api(`/api/matches/${id}/join`, { method: "POST" }));

  /** Quick match: join the longest-waiting table with this time control, or open one and wait. */
  const quickMatch = () =>
    go("quick", async () => {
      const open = await api<PublicTables>(`/api/tables?game=chess&view=open&sort=oldest&page=0`);
      const mine = new Set((data?.mine ?? []).map((m) => m.matchId));
      const table = open.tables.find((t) => t.clock === tc && !mine.has(t.matchId));
      if (table) return api<{ matchId: string }>(`/api/matches/${table.matchId}/join`, { method: "POST" });
      const r = await api<{ matchId: string }>("/api/tables", { method: "POST", body: { game: "chess", timeControl: tc, visibility: "public" } });
      watchTable(r.matchId);
      return r;
    });

  const passAndPlay = () => go("local", () => api("/api/matches", { method: "POST", body: { mode: "local", game: "chess", targetPoints: 1 } }));
  const cancel = async (id: string) => {
    try {
      await api(`/api/matches/${id}/cancel`, { method: "POST" });
      unwatchTable(id);
      load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    }
  };
  const myIds = useMemo(() => new Set((data?.mine ?? []).map((m) => m.matchId)), [data]);
  const tcInfo = TIME_CONTROLS.find((t) => t.id === tc)!;

  return (
    <main className="page lobby">
      <Announcements />
      <section className="lobby-head">
        <div>
          <Link className="lobby-back" href="/play" transitionTypes={["nav-back"]}>
            ← All games
          </Link>
          <h1 className="display">Chess</h1>
        </div>
        <div className="pulse-chips" aria-live="polite">
          <span className="pulse-chip">
            <span className="live-dot" aria-hidden />
            <CountUp value={data?.counts.online ?? 0} /> online
          </span>
          <span className="pulse-chip">
            <CountUp value={data?.counts.playing ?? 0} /> playing
          </span>
        </div>
      </section>

      <section className="lobby-length">
        <span className="muted small">Time control</span>
        <div className="seg compact tc-seg" role="group" aria-label="Time control">
          {TIME_CONTROLS.map((t) => (
            <button
              key={t.id}
              className="chip"
              aria-pressed={tc === t.id}
              onClick={() => setTc(t.id)}
              title={`${t.kind}: ${t.baseMs / 60000} min + ${t.incMs / 1000} s a move`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="play-tiles" aria-label="Play chess">
        <PlayTile
          primary
          glyph="♞"
          title="Quick match"
          text={`${tcInfo.kind} ${tcInfo.label} · rated · paired with the next player`}
          busy={busy === "quick"}
          badge={
            data && data.counts.open > 0 ? (
              <span className="play-tile-badge">
                <span className="live-dot" aria-hidden /> {data.counts.open} waiting
              </span>
            ) : undefined
          }
          onClick={quickMatch}
        />
        <PlayTile glyph="♜" title="Find a game" text="Browse open chess tables" onClick={() => setBrowsing("open")} />
        <PlayTile glyph="♛" title="Create table" text="Public or invite-only · your time control and colour" onClick={() => setCreating(true)} />
        <PlayTile glyph="♚" title="vs Computer" text="Easy, medium or hard · starts instantly" busy={busy === "bot"} onClick={() => setComputer(true)} />
        <PlayTile glyph="♝" title="Pass & play" text="Two players on one device" busy={busy === "local"} onClick={passAndPlay} />
      </section>
      {error && <p className="err small">{error}</p>}

      <button className="watch-row" onClick={() => setBrowsing("live")}>
        <span className="live-dot" aria-hidden />
        <span>
          <strong>Watch live</strong>
          <span className="muted small">
            {" "}
            · {data?.counts.live ?? 0} public game{(data?.counts.live ?? 0) === 1 ? "" : "s"} in progress
          </span>
        </span>
        <span aria-hidden>→</span>
      </button>

      {data && data.mine.length > 0 && (
        <section className="card accent">
          <div className="card-title">
            <span className="badge live">Yours</span>
            <h2>Your game</h2>
          </div>
          <ul className="list">
            {data.mine.map((m) => (
              <li key={m.matchId}>
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 650 }}>
                    {m.status === "WAITING" ? `${MODE_LABEL[m.mode]} · waiting for an opponent` : `${m.players[0].name} vs ${m.players[1].name}`}
                  </div>
                  <div className="muted small">
                    {m.gameType === "chess" ? "♟ Chess" : `⚀ Backgammon · ${m.targetPoints}-pt`} · {MODE_LABEL[m.mode]}
                  </div>
                </div>
                <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  {m.status === "WAITING" && m.host && (
                    <button className="btn sm ghost" onClick={() => cancel(m.matchId)}>
                      Close
                    </button>
                  )}
                  <Link className="btn sm primary" href={`/match/${m.matchId}`} transitionTypes={["nav-forward"]}>
                    {m.status === "WAITING" ? "Open" : "Resume"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {browsing && (
        <RoomBrowser
          game="chess"
          initialView={browsing}
          myIds={myIds}
          busy={busy}
          onJoin={join}
          onWatch={(id) => router.push(`/match/${id}`)}
          onCreate={() => {
            setBrowsing(null);
            setCreating(true);
          }}
          onClose={() => setBrowsing(null)}
        />
      )}
      {creating && <CreateChessTable initialTc={tc} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/match/${id}`)} />}
      {computer && (
        <ComputerGame
          busy={busy === "bot"}
          onClose={() => setComputer(false)}
          onStart={(level, color) =>
            go("bot", () => api("/api/matches", { method: "POST", body: { mode: "bot", game: "chess", targetPoints: 1, botLevel: level, color } }))
          }
        />
      )}
    </main>
  );
}

function ColorPicker({ color, onChange }: { color: Color; onChange: (c: Color) => void }) {
  return (
    <div className="seg" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Your colour">
      {(
        [
          ["white", "♔ White"],
          ["random", "Random"],
          ["black", "♚ Black"],
        ] as const
      ).map(([id, label]) => (
        <button key={id} className="chip" aria-pressed={color === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ComputerGame({ busy, onClose, onStart }: { busy: boolean; onClose: () => void; onStart: (level: number, color: Color) => void }) {
  const [level, setLevel] = useState(2);
  const [color, setColor] = useState<Color>("random");
  return (
    <Modal title="Play the computer" onClose={onClose}>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Strength
        </div>
        <div className="seg" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Strength">
          {LEVELS.map((l) => (
            <button key={l.id} className="chip" aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Your colour
        </div>
        <ColorPicker color={color} onChange={setColor} />
      </div>
      <p className="muted small">No clock and no rating — take your time.</p>
      <div className="grid2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={() => onStart(level, color)}>
          {busy ? "Starting…" : "Start game"}
        </button>
      </div>
    </Modal>
  );
}

function CreateChessTable({ initialTc, onClose, onCreated }: { initialTc: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [tc, setTc] = useState(initialTc);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [color, setColor] = useState<Color>("random");
  const [ranked, setRanked] = useState(true);
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/tables", {
        method: "POST",
        body: { game: "chess", timeControl: tc, visibility, color, ranked, allowSpectators },
      });
      watchTable(matchId);
      onCreated(matchId);
    } catch (e) {
      if (isHandled(e)) onClose();
      else setError(e instanceof Error ? e.message : "Could not create the table");
      setBusy(false);
    }
  };
  const info = TIME_CONTROLS.find((t) => t.id === tc);
  return (
    <Modal title="Create a chess table" onClose={onClose}>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Time control
        </div>
        <div className="seg tc-seg" role="group" aria-label="Time control">
          {TIME_CONTROLS.map((t) => (
            <button key={t.id} className="chip" aria-pressed={tc === t.id} onClick={() => setTc(t.id)}>
              {t.label}
            </button>
          ))}
          <button className="chip" aria-pressed={tc === "none"} onClick={() => setTc("none")}>
            None
          </button>
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          {info
            ? `${info.kind}: ${info.baseMs / 60000} minutes each${info.incMs ? `, plus ${info.incMs / 1000} s after every move` : ""}. Running out of time loses.`
            : "Relaxed play with friends: no time limit and no rating."}
        </p>
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Who can join
        </div>
        <div className="grid2">
          <button className="choice" aria-pressed={visibility === "public"} onClick={() => setVisibility("public")}>
            <strong>Public</strong>
            <span className="muted small">Listed in the lobby</span>
          </button>
          <button className="choice" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}>
            <strong>Invite only</strong>
            <span className="muted small">Anyone with your link</span>
          </button>
        </div>
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Your colour
        </div>
        <ColorPicker color={color} onChange={setColor} />
      </div>
      {visibility === "public" && tc !== "none" && (
        <label className="toggle">
          <span>
            <strong>Rated</strong>
            <span className="muted small" style={{ display: "block" }}>
              The result moves both players&apos; chess ratings.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={ranked} onChange={(e) => setRanked(e.target.checked)} />
        </label>
      )}
      <label className="toggle">
        <span>
          <strong>Allow spectators</strong>
        </span>
        <input type="checkbox" role="switch" checked={allowSpectators} onChange={(e) => setAllowSpectators(e.target.checked)} />
      </label>
      {error && <p className="err small">{error}</p>}
      <div className="grid2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? "Opening…" : "Open table"}
        </button>
      </div>
    </Modal>
  );
}
