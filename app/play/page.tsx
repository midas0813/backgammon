"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Announcements from "@/components/Announcements";
import CountUp from "@/components/CountUp";
import GameSwitcher from "@/components/GameSwitcher";
import PlayTile from "@/components/PlayTile";
import Modal from "@/components/Modal";
import RoomBrowser, { type RoomView } from "@/components/RoomBrowser";
import { ClientApiError, api, isHandled } from "@/lib/client/api";
import { watchTable, unwatchTable } from "@/lib/client/tables";
import { toast } from "@/lib/client/toast";
import { useCurrentGame } from "@/lib/client/game";
import type { TournamentList } from "@/components/TournamentsCard";
import type { Lobby } from "@/lib/server/lobby";

type Poll = Lobby | { unchanged: true; version: string };

const POLL_MS = 4000;
const LENGTHS = [1, 3, 5, 7];
const MODE_LABEL: Record<string, string> = { quick: "Public table", private: "Invite", local: "Pass & play", bot: "vs Computer" };

function age(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

export default function LobbyPage() {
  const router = useRouter();
  // The Play tab opens the game the player last chose.
  const current = useCurrentGame();
  useEffect(() => {
    if (current === "chess") router.replace("/play/chess");
  }, [current, router]);
  const [data, setData] = useState<Lobby | null>(null);
  const [points, setPoints] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState<RoomView | null>(null);
  const versionRef = useRef<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentList | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const v = !force && versionRef.current ? `?v=${versionRef.current}` : "";
      const d = await api<Poll>(`/api/lobby${v}`);
      if ("unchanged" in d) return;
      versionRef.current = d.version;
      setData(d);
      // Hosted tables keep being watched app-wide, also after a reload.
      for (const m of d.mine) if (m.host && m.status === "WAITING" && m.mode !== "local") watchTable(m.matchId);
    } catch {}
  }, []);

  useEffect(() => {
    load(true);
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    // Links like /play?find=1 open a window; read after hydration because the server has no URL state here.
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration
    if (q.get("create")) setCreating(true);
    else if (q.get("find")) setBrowsing("open");
    else if (q.get("watch")) setBrowsing("live");
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

  useEffect(() => {
    api<TournamentList>("/api/tournaments")
      .then(setTournaments)
      .catch(() => {});
  }, []);
  // The open table closest to starting, shown on the Tournaments tile.
  const filling = tournaments?.open.filter((t) => t.registered > 0).sort((a, b) => b.registered / b.size - a.registered / a.size)[0];

  const vsComputer = () => go("bot", () => api("/api/matches", { method: "POST", body: { mode: "bot", targetPoints: points } }));
  const passAndPlay = () => go("local", () => api("/api/matches", { method: "POST", body: { mode: "local", targetPoints: points } }));
  const join = (id: string) => go(`join:${id}`, () => api(`/api/matches/${id}/join`, { method: "POST" }));
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

  return (
    <main className="page lobby">
      <Announcements />
      <section className="lobby-head">
        <div>
          <GameSwitcher game="backgammon" />
          <h1 className="display">Lobby</h1>
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

      <section className="play-tiles" aria-label="Play">
        <PlayTile
          primary
          image="find-game"
          title="Find a game"
          text={data ? `${data.counts.open} open table${data.counts.open === 1 ? "" : "s"} · pick one and play` : "Browse open tables"}
          badge={
            data && data.counts.open > 0 ? (
              <span className="play-tile-badge">
                <span className="live-dot" aria-hidden /> {data.counts.open} waiting
              </span>
            ) : undefined
          }
          onClick={() => setBrowsing("open")}
        />
        <PlayTile
          image="tournament"
          title="Tournaments"
          text="Free sit & go · 4 or 8 players · win XP"
          badge={
            filling ? (
              <span className="play-tile-badge">
                <span className="live-dot" aria-hidden /> {filling.name} · {filling.registered}/{filling.size} joined
              </span>
            ) : undefined
          }
          onClick={() => router.push("/tournaments")}
        />
        <PlayTile image="create-room" title="Create table" text="Public or invite-only · your rules" onClick={() => setCreating(true)} />
        <PlayTile image="vs-computer" title="vs Computer" text={`${points}-point match · starts instantly`} busy={busy === "bot"} onClick={vsComputer} />
        <PlayTile image="pass-and-play" title="Pass & play" text="Two players on one device" busy={busy === "local"} onClick={passAndPlay} />
      </section>

      <section className="lobby-length">
        <span className="muted small">Match length for new games</span>
        <div className="seg compact" role="group" aria-label="Match length">
          {LENGTHS.map((p) => (
            <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
              {p} pt
            </button>
          ))}
        </div>
      </section>
      {error && <p className="err small">{error}</p>}

      <button className="watch-row" onClick={() => setBrowsing("live")}>
        <span className="live-dot" aria-hidden />
        <span>
          <strong>Watch live</strong>
          <span className="muted small">
            {" "}
            · {data?.counts.live ?? 0} public match{(data?.counts.live ?? 0) === 1 ? "" : "es"} in progress
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
                    {m.gameType === "chess" ? "♟ Chess" : `${m.targetPoints}-pt`} ·{" "}
                    {m.status === "WAITING" ? `opened ${age(m.createdAt)} ago` : `${MODE_LABEL[m.mode]} · ${m.score[0]}–${m.score[1]}`}
                    {m.mode !== "bot" && m.mode !== "local" && !m.allowSpectators ? " · no spectators" : ""}
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
      {creating && <CreateTable initialPoints={points} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/match/${id}`)} />}
    </main>
  );
}

function CreateTable({ initialPoints, onClose, onCreated }: { initialPoints: number; onClose: () => void; onCreated: (id: string) => void }) {
  const [points, setPoints] = useState(initialPoints);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [spectatorChat, setSpectatorChat] = useState(true);
  const [spectatorEmoji, setSpectatorEmoji] = useState(true);
  const [clock, setClock] = useState<"standard" | "fast" | "none">("standard");
  const [ranked, setRanked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/tables", {
        method: "POST",
        body: { targetPoints: points, visibility, allowSpectators, spectatorChat, spectatorEmoji, clock, ranked },
      });
      watchTable(matchId);
      onCreated(matchId);
    } catch (e) {
      if (isHandled(e)) onClose();
      else setError(e instanceof Error ? e.message : "Could not create the table");
      setBusy(false);
    }
  };
  return (
    <Modal title="Create a table" onClose={onClose}>
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Match length
        </div>
        <div className="seg" role="group" aria-label="Match length">
          {LENGTHS.map((p) => (
            <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
              {p} pt
            </button>
          ))}
        </div>
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
          Clock
        </div>
        <div className="seg" role="group" aria-label="Clock">
          {(
            [
              ["standard", "Standard"],
              ["fast", "Fast"],
              ["none", "No clock"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className="chip" aria-pressed={clock === id} onClick={() => setClock(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          {clock === "standard"
            ? `12 s free per move, then a time bank of ${Math.max(2, points)} min. Running out loses the match.`
            : clock === "fast"
              ? `8 s free per move, then a time bank of ${Math.max(1, points / 2)} min.`
              : "Relaxed play with friends: no time limits."}
        </p>
      </div>
      {visibility === "public" && clock !== "none" && (
        <label className="toggle">
          <span>
            <strong>Ranked</strong>
            <span className="muted small" style={{ display: "block" }}>
              The result moves both players&apos; ratings.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={ranked} onChange={(e) => setRanked(e.target.checked)} />
        </label>
      )}
      <label className="toggle">
        <span>
          <strong>Allow spectators</strong>
          <span className="muted small" style={{ display: "block" }}>
            {visibility === "public" ? "Your match appears under Watch now." : "People with the link can watch."} You can change this during the match.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={allowSpectators} onChange={(e) => setAllowSpectators(e.target.checked)} />
      </label>
      {allowSpectators && (
        <>
          <label className="toggle">
            <span>
              <strong>Spectators can chat</strong>
              <span className="muted small" style={{ display: "block" }}>
                Messages and quick phrases. You two can always chat.
              </span>
            </span>
            <input type="checkbox" role="switch" checked={spectatorChat} onChange={(e) => setSpectatorChat(e.target.checked)} />
          </label>
          <label className="toggle">
            <span>
              <strong>Spectators can send reactions</strong>
              <span className="muted small" style={{ display: "block" }}>
                👏 🔥 😮 float over the board
              </span>
            </span>
            <input type="checkbox" role="switch" checked={spectatorEmoji} onChange={(e) => setSpectatorEmoji(e.target.checked)} />
          </label>
        </>
      )}
      <ul className="list small">
        <li>
          <span>Stake</span>
          <span>Free · token stakes not enabled</span>
        </li>
        <li>
          <span>Closes</span>
          <span className="muted">{visibility === "public" ? "15 min after you leave, or after 1 hour" : "If not accepted within 15 min"}</span>
        </li>
        <li>
          <span>Games</span>
          <span className="muted">One at a time</span>
        </li>
      </ul>
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
