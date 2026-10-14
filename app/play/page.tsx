"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import CountUp from "@/components/CountUp";
import Modal from "@/components/Modal";
import { ClientApiError, api } from "@/lib/client/api";
import { watchTable, unwatchTable } from "@/lib/client/tables";
import { toast } from "@/lib/client/toast";
import type { Lobby } from "@/lib/server/lobby";

type Poll = Lobby | { unchanged: true; version: string };

const POLL_MS = 2000;
const LENGTHS = [1, 3, 5, 7];
const MODE_LABEL: Record<string, string> = { quick: "Public table", private: "Invite", local: "Pass & play", bot: "vs Computer" };

function age(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

const Icon = ({ d }: { d: string }) => (
  <span className="mode-icon" aria-hidden>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  </span>
);

/** Rows that appeared since the last poll get an entrance animation. */
function useFresh(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const id of ids) if (!seen.current.has(id)) fresh.add(id);
  useEffect(() => {
    seen.current = new Set(ids);
  });
  return fresh;
}

export default function LobbyPage() {
  const router = useRouter();
  const [data, setData] = useState<Lobby | null>(null);
  const [points, setPoints] = useState(3);
  const [filter, setFilter] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const versionRef = useRef<string | null>(null);

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
    if (new URLSearchParams(window.location.search).get("create")) setCreating(true);
    return () => window.clearInterval(t);
  }, [load]);

  const go = async (key: string, fn: () => Promise<{ matchId: string; joined?: boolean; watch?: boolean }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r.watch && !r.joined) watchTable(r.matchId);
      router.push(`/match/${r.matchId}`);
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "EVENT_FULL") {
        toast("Someone just took that seat — try another table.", { tone: "warn" });
        load(true);
      } else setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  };

  const findGame = () =>
    go("find", async () => ({
      ...(await api<{ matchId: string; joined?: boolean }>("/api/tables/find", { method: "POST", body: { targetPoints: points } })),
      watch: true,
    }));
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

  const open = (data?.open ?? []).filter((t) => !filter || t.targetPoints === filter);
  const freshOpen = useFresh(open.map((t) => t.matchId));
  const freshLive = useFresh((data?.live ?? []).map((t) => t.matchId));

  return (
    <main className="page lobby">
      <section className="lobby-head">
        <div>
          <span className="eyebrow">Free play</span>
          <h1 className="display">Lobby</h1>
        </div>
        <div className="pulse-chips" aria-live="polite">
          <span className="pulse-chip">
            <span className="live-dot" aria-hidden />
            <CountUp value={data?.counts.online ?? 0} /> online
          </span>
          <span className="pulse-chip">
            <CountUp value={data?.counts.live ?? 0} /> live
          </span>
          <span className="pulse-chip">
            <CountUp value={data?.counts.open ?? 0} /> open
          </span>
        </div>
      </section>

      <section className="card">
        <div className="spread">
          <h2>Play</h2>
          <div className="seg compact" role="group" aria-label="Match length">
            {LENGTHS.map((p) => (
              <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
                {p} pt
              </button>
            ))}
          </div>
        </div>
        <div className="mode-grid">
          <button className="mode-tile primary" disabled={!!busy} onClick={findGame}>
            <Icon d="M13 2 3 14h8l-1 8 10-12h-8z" />
            <strong>{busy === "find" ? "Searching…" : "Find a game"}</strong>
            <span className="muted small">Join the next open {points}-pt table, or open one</span>
          </button>
          <button className="mode-tile" disabled={!!busy} onClick={() => setCreating(true)}>
            <Icon d="M12 5v14M5 12h14" />
            <strong>Create table</strong>
            <span className="muted small">Public or invite-only, your rules</span>
          </button>
          <button className="mode-tile" disabled={!!busy} onClick={vsComputer}>
            <Icon d="M5 8h14v11H5zM12 4v4M9 13h.01M15 13h.01M9 16h6" />
            <strong>{busy === "bot" ? "Starting…" : "vs Computer"}</strong>
            <span className="muted small">No waiting</span>
          </button>
          <button className="mode-tile" disabled={!!busy} onClick={passAndPlay}>
            <Icon d="M7 3h10v18H7zM11 18h2" />
            <strong>{busy === "local" ? "Starting…" : "Pass & play"}</strong>
            <span className="muted small">Two players, one device</span>
          </button>
        </div>
        {error && <p className="err small">{error}</p>}
      </section>

      {data && data.mine.length > 0 && (
        <section className="card accent">
          <div className="card-title">
            <span className="badge live">Yours</span>
            <h2>Your tables & matches</h2>
          </div>
          <ul className="list">
            {data.mine.map((m) => (
              <li key={m.matchId}>
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 650 }}>
                    {m.status === "WAITING" ? `${MODE_LABEL[m.mode]} · waiting for an opponent` : `${m.players[0].name} vs ${m.players[1].name}`}
                  </div>
                  <div className="muted small">
                    {m.targetPoints}-pt · {m.status === "WAITING" ? `opened ${age(m.createdAt)} ago` : `${MODE_LABEL[m.mode]} · ${m.score[0]}–${m.score[1]}`}
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

      <section className="card">
        <div className="spread">
          <h2>Open tables</h2>
          <div className="seg compact five" role="group" aria-label="Filter by match length">
            <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
              All
            </button>
            {LENGTHS.map((p) => (
              <button key={p} className="chip" aria-pressed={filter === p} onClick={() => setFilter(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {!data ? (
          <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />
        ) : open.length === 0 ? (
          <div className="empty-row">
            <span className="radar small" aria-hidden />
            <span className="muted small">
              No open {filter ? `${filter}-pt ` : ""}tables right now. Create one, or tap Find a game and the next player is seated with you.
            </span>
          </div>
        ) : (
          <ul className="list">
            {open.map((t, i) => (
              <li key={t.matchId} className={freshOpen.has(t.matchId) ? "enter" : undefined} style={{ animationDelay: `${i * 40}ms` }}>
                <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <span className="avatar-wrap">
                    <Avatar name={t.host.name} src={t.host.avatarUrl} size={36} />
                    <span className={`presence ${t.hostOnline ? "on" : "away"}`} aria-label={t.hostOnline ? "online" : "away"} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: "block", fontWeight: 650 }}>
                      {t.host.name}
                    </span>
                    <span className="muted small">
                      {t.targetPoints}-pt · Free · waiting {age(t.createdAt)}
                    </span>
                  </span>
                </span>
                <button className="btn sm primary" disabled={!!busy} onClick={() => join(t.matchId)}>
                  {busy === `join:${t.matchId}` ? "Joining…" : "Join"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <span className="badge live">Live</span>
          <h2>Watch now</h2>
        </div>
        {!data ? (
          <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />
        ) : data.live.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No public matches in progress. When players start one, it shows up here to watch.
          </p>
        ) : (
          <ul className="list">
            {data.live.map((m, i) => (
              <li key={m.matchId} className={freshLive.has(m.matchId) ? "enter" : undefined} style={{ animationDelay: `${i * 40}ms` }}>
                <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <span className="avatar-pair">
                    <Avatar name={m.players[0].name} src={m.players[0].avatarUrl} size={30} />
                    <Avatar name={m.players[1].name} src={m.players[1].avatarUrl} size={30} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: "block", fontWeight: 650 }}>
                      {m.players[0].name} vs {m.players[1].name}
                    </span>
                    <span className="muted small">
                      <span className="mono score-tick" key={`${m.score[0]}-${m.score[1]}`}>
                        {m.score[0]}–{m.score[1]}
                      </span>{" "}
                      to {m.targetPoints} · game {m.gameNumber}
                      {m.cube > 1 ? ` · cube ${m.cube}` : ""}
                    </span>
                  </span>
                </span>
                <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  {m.spectators > 0 && (
                    <span className="muted small eye-count" style={{ whiteSpace: "nowrap" }} aria-label={`${m.spectators} watching`}>
                      👁 {m.spectators}
                    </span>
                  )}
                  <Link className="btn sm" href={`/match/${m.matchId}`} transitionTypes={["nav-forward"]}>
                    Watch
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="row">
        <span className="badge">Ranked · coming soon</span>
        <span className="badge">Tournaments · coming soon</span>
        <span className="badge">Token stakes · not enabled</span>
      </div>

      {creating && <CreateTable initialPoints={points} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/match/${id}`)} />}
    </main>
  );
}

function CreateTable({ initialPoints, onClose, onCreated }: { initialPoints: number; onClose: () => void; onCreated: (id: string) => void }) {
  const [points, setPoints] = useState(initialPoints);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/tables", { method: "POST", body: { targetPoints: points, visibility, allowSpectators } });
      watchTable(matchId);
      onCreated(matchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the table");
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
      <label className="toggle">
        <span>
          <strong>Allow spectators</strong>
          <span className="muted small" style={{ display: "block" }}>
            {visibility === "public" ? "Your match appears under Watch now." : "People with the link can watch."} You can change this during the match.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={allowSpectators} onChange={(e) => setAllowSpectators(e.target.checked)} />
      </label>
      <ul className="list small">
        <li>
          <span>Stake</span>
          <span>Free · token stakes not enabled</span>
        </li>
        <li>
          <span>Clock</span>
          <span className="muted">Coming soon</span>
        </li>
        <li>
          <span>Closes</span>
          <span className="muted">After 15 min if you leave</span>
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
