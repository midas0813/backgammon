"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/client/api";
import { formatTokens } from "@/lib/fees";
import type { PublicTables } from "@/lib/server/lobby";

export type RoomView = "open" | "live";

const LENGTHS = [1, 3, 5, 7];
const FEES: { id: string; label: string; paid: boolean }[] = [
  { id: "all", label: "All", paid: false },
  { id: "free", label: "Free", paid: false },
  { id: "1-10", label: "1–10", paid: true },
  { id: "10-50", label: "10–50", paid: true },
  { id: "50+", label: "50+", paid: true },
];
const POLL_MS = 4000;

function age(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

/**
 * Full-screen room browser (a centred window on large screens): filter, page and join open tables,
 * or watch live matches. The list is the shared, cached /api/tables page, refreshed every few seconds.
 */
export default function RoomBrowser({
  game = "backgammon",
  initialView,
  myIds,
  busy,
  paidEnabled = false,
  onJoin,
  onWatch,
  onCreate,
  onClose,
}: {
  /** Which game's tables to list. */
  game?: "backgammon" | "chess";
  initialView: RoomView;
  /** Tables the viewer hosts: shown as "Your table" instead of Join. */
  myIds: Set<string>;
  busy: string | null;
  paidEnabled?: boolean;
  onJoin: (id: string) => void;
  onWatch: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<RoomView>(initialView);
  const [points, setPoints] = useState<number | null>(null);
  const [fee, setFee] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<PublicTables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const gridRef = useRef<HTMLDivElement>(null);

  const chess = game === "chess";
  const query = `/api/tables?game=${game}&view=${view}&sort=${sort}&page=${page}&fee=${fee}${points ? `&points=${points}` : ""}`;
  const load = useCallback(async () => {
    try {
      const d = await api<PublicTables>(query);
      setData(d);
      setNow(Date.now());
      setError(null);
      // A filter that now has fewer pages moves back to the last one.
      if (d.page > 0 && d.page >= d.pages) setPage(d.pages - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tables");
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: state is set after the request returns
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  // New filter → back to page 1 and the top of the grid.
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
      gridRef.current?.scrollTo({ top: 0 });
    };

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const tables = data?.view === view ? data.tables : [];

  const feeLabel = (units: number) => (units === 0 ? "Free" : `${formatTokens(units)} tokens`);

  return createPortal(
    <div className="rb-backdrop" onClick={onClose}>
      <section
        className="rb"
        role="dialog"
        aria-modal="true"
        aria-label={view === "open" ? "Find a game" : "Live matches"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rb-head">
          <div className="rb-tabs" role="tablist">
            <button role="tab" aria-selected={view === "open"} onClick={() => change(setView)("open")}>
              Open tables
            </button>
            <button role="tab" aria-selected={view === "live"} onClick={() => change(setView)("live")}>
              <span className="live-dot" aria-hidden /> Live now
            </button>
          </div>
          <button className="rb-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="rb-filters">
          {!chess && (
            <div className="rb-filter">
              <span className="rb-filter-label">Length</span>
              <div className="rb-chips" role="group" aria-label="Match length">
                <button className="chip" aria-pressed={points === null} onClick={() => change(setPoints)(null)}>
                  All
                </button>
                {LENGTHS.map((p) => (
                  <button key={p} className="chip" aria-pressed={points === p} onClick={() => change(setPoints)(p)}>
                    {p} pt
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="rb-filter">
            <span className="rb-filter-label">Entry fee</span>
            <div className="rb-chips" role="group" aria-label="Entry fee">
              {FEES.map((f) => (
                <button
                  key={f.id}
                  className="chip"
                  aria-pressed={fee === f.id}
                  disabled={f.paid && !paidEnabled}
                  title={f.paid && !paidEnabled ? "Token tables are coming soon" : undefined}
                  onClick={() => change(setFee)(f.id)}
                >
                  {f.label}
                  {f.paid && !paidEnabled && <span className="rb-soon">soon</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="rb-filter rb-sort">
            <span className="rb-count" aria-live="polite">
              {data
                ? `${data.total} ${view === "open" ? (data.total === 1 ? "open table" : "open tables") : data.total === 1 ? "live match" : "live matches"}`
                : "Loading…"}
            </span>
            <select value={sort} onChange={(e) => change(setSort)(e.target.value as "newest" | "oldest")} aria-label="Sort">
              <option value="newest">{view === "open" ? "Newest first" : "Started recently"}</option>
              <option value="oldest">{view === "open" ? "Waiting longest" : "Running longest"}</option>
            </select>
          </div>
        </div>

        <div className="rb-body" ref={gridRef}>
          {error && <p className="err small">{error}</p>}
          {!data ? (
            <div className="rb-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="room-card skeleton" style={{ minHeight: 230 }} />
              ))}
            </div>
          ) : tables.length === 0 ? (
            <div className="rb-empty">
              <span className="radar" aria-hidden />
              <strong>{view === "open" ? "No open tables match these filters" : "No live matches to watch right now"}</strong>
              <span className="muted small">
                {view === "open"
                  ? "Open your own table and the next player can join you. This list updates live."
                  : "Matches appear here as soon as players start them."}
              </span>
              {view === "open" && (
                <button className="btn primary" onClick={onCreate}>
                  Create a table
                </button>
              )}
            </div>
          ) : (
            <div className="rb-grid">
              {tables.map((t, i) => {
                const mine = myIds.has(t.matchId);
                return (
                  <article key={t.matchId} className="room-card enter" style={{ animationDelay: `${(i % 8) * 35}ms` }}>
                    <div className="room-top">
                      <span className="room-badge">{chess ? `⏱ ${t.clock === "none" ? "No clock" : t.clock}` : `${t.targetPoints}-pt`}</span>
                      <span className={`room-badge ${t.entryFee ? "paid" : "free"}`}>{feeLabel(t.entryFee)}</span>
                      {!chess && t.clock !== "none" && <span className="room-badge">⏱ {t.clock === "fast" ? "Fast" : "Clock"}</span>}
                      {t.ranked && <span className="room-badge ranked">Ranked</span>}
                    </div>
                    <div className="room-seats">
                      <span className="room-seat">
                        <Avatar name={t.host.name} src={t.host.avatarUrl} size={64} />
                        {view === "open" && <span className={`presence ${t.hostOnline ? "on" : "away"}`} aria-label={t.hostOnline ? "online" : "away"} />}
                      </span>
                      {view === "open" ? (
                        <span className="room-seat empty" aria-label="Free seat">
                          <span>+</span>
                        </span>
                      ) : (
                        <span className="room-seat">
                          <Avatar name={t.opponent?.name ?? "?"} src={t.opponent?.avatarUrl} size={64} />
                        </span>
                      )}
                    </div>
                    {view === "open" ? (
                      <div className="room-info">
                        <strong className="ellipsis">{t.host.name}</strong>
                        <span className="muted small">{t.hostOnline ? `waiting ${age(t.createdAt, now)}` : "host away · we'll alert them when you join"}</span>
                      </div>
                    ) : (
                      <div className="room-info">
                        <strong className="ellipsis">
                          {t.host.name} vs {t.opponent?.name}
                        </strong>
                        <span className="muted small">
                          {chess ? (
                            `in progress · ${t.clock}`
                          ) : (
                            <>
                              <span className="mono">
                                {t.score?.[0]}–{t.score?.[1]}
                              </span>{" "}
                              to {t.targetPoints} · game {t.gameNumber}
                            </>
                          )}
                          {t.spectators > 0 ? ` · 👁 ${t.spectators}` : ""}
                        </span>
                      </div>
                    )}
                    {view === "open" ? (
                      mine ? (
                        <span className="room-mine">Your table</span>
                      ) : (
                        <button className="btn sm primary block" disabled={!!busy} onClick={() => onJoin(t.matchId)}>
                          {busy === `join:${t.matchId}` ? "Joining…" : "Join table"}
                        </button>
                      )
                    ) : (
                      <button className="btn sm block" onClick={() => onWatch(t.matchId)}>
                        Watch
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="rb-foot">
          <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span className="muted small">
            Page {Math.min(page + 1, data?.pages ?? 1)} of {data?.pages ?? 1}
          </span>
          <button className="btn sm" disabled={!data || page + 1 >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
          {view === "open" && (
            <button className="btn sm primary rb-create" onClick={onCreate}>
              + Create table
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
