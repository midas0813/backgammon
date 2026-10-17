"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { dashboard } from "@/lib/server/admin/service";
import { DailyBars, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof dashboard>>;

function Tile({ label, value, note, onClick, tone }: { label: string; value: number | string; note?: string; onClick?: () => void; tone?: "warn" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`a-tile${tone ? ` ${tone}` : ""}`} onClick={onClick}>
      <span className="a-tile-label">{label}</span>
      <strong className="a-tile-value">{value}</strong>
      {note && <span className="a-tile-note">{note}</span>}
    </Tag>
  );
}

export default function Dashboard() {
  const { open } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/dashboard")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!d) return error ? <p className="err">{error}</p> : <div className="skeleton" style={{ height: 240, borderRadius: 14 }} />;
  return (
    <div className="a-stack">
      {d.settings.maintenance.enabled && (
        <div className="a-banner warn">
          <strong>Maintenance mode is on.</strong> New matches are blocked.{" "}
          <button className="link" onClick={() => open("settings")}>
            Settings →
          </button>
        </div>
      )}
      <section>
        <h3 className="a-h3">Players</h3>
        <div className="a-tiles">
          <Tile label="Online now" value={d.users.online} />
          <Tile label="Active today" value={d.users.activeToday} note="UTC day" />
          <Tile label="New today" value={d.users.newToday} />
          <Tile label="Wallet accounts" value={d.users.registered} note={`of ${d.users.total} total`} onClick={() => open("users")} />
        </div>
      </section>
      <section>
        <h3 className="a-h3">Games</h3>
        <div className="a-tiles">
          <Tile label="Live matches" value={d.matches.live} onClick={() => open("matches")} />
          <Tile label="Open tables" value={d.matches.openTables} />
          <Tile label="Finished today" value={d.matches.completedToday} />
          <Tile label="Games played" value={d.matches.gamesPlayed} note="all time" />
        </div>
      </section>
      <section>
        <h3 className="a-h3">Needs attention</h3>
        <div className="a-tiles">
          <Tile label="Open reports" value={d.openReports} tone={d.openReports ? "warn" : undefined} onClick={() => open("reports")} />
          <Tile label="Fair-play flags" value={d.openFlags} tone={d.openFlags ? "warn" : undefined} onClick={() => open("fairplay")} />
          <Tile label="Errors (24 h)" value={d.errors.lastDay} tone={d.errors.lastDay ? "warn" : undefined} />
          {d.finance && (
            <>
              <Tile label="Deposits pending" value={d.finance.pendingDeposits} onClick={() => open("finance")} />
              <Tile
                label="Deposits in review"
                value={d.finance.reviewDeposits}
                tone={d.finance.reviewDeposits ? "warn" : undefined}
                onClick={() => open("finance")}
              />
              <Tile
                label="Adjustments to approve"
                value={d.finance.pendingAdjustments}
                tone={d.finance.pendingAdjustments ? "warn" : undefined}
                onClick={() => open("finance")}
              />
            </>
          )}
        </div>
      </section>
      {d.errors.recent.length > 0 && (
        <section className="a-card">
          <h3 className="a-h3">Latest errors</h3>
          <p className="muted small">Each has the reference number the player saw. Search a player&apos;s report for it.</p>
          <ol className="a-events">
            {d.errors.recent.map((e) => (
              <li key={e.id}>
                <span className="mono">{e.ref}</span> <strong>{e.source}</strong> <span className="muted small">{fmtDate(e.createdAt)}</span>
                {e.path && <span className="muted small"> · {e.path}</span>}
                {e.userId && (
                  <button className="link small" onClick={() => open("users", e.userId!)}>
                    {" "}
                    player
                  </button>
                )}
                <code>{e.message}</code>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="a-grid2">
        <DailyBars title="New players" data={d.daily.newUsers} color="#65E2BC" />
        <DailyBars title="Finished matches" data={d.daily.completedMatches} color="#9DB7FF" />
      </div>
    </div>
  );
}
