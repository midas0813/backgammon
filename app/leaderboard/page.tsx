"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import WalletButton from "@/components/WalletButton";
import { api } from "@/lib/client/api";
import { formatTokens } from "@/lib/fees";
import type { Leaderboard } from "@/lib/server/leaderboard";

function countdown(iso: string, now: number) {
  const ms = Math.max(0, Date.parse(iso) - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d ? `${d} d ${h} h` : `${h} h ${m} min`;
}

/** Weekly and season standings, the prize zone and your own rank. */
export default function LeaderboardPage() {
  const [period, setPeriod] = useState<"week" | "season">("week");
  const [data, setData] = useState<Leaderboard | null>(null);
  const [now, setNow] = useState(0);
  const load = useCallback(() => {
    api<Leaderboard>(`/api/leaderboard?period=${period}`)
      .then((d) => {
        setData(d);
        setNow(Date.now());
      })
      .catch(() => {});
  }, [period]);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <main className="page leaderboard">
      <section className="lobby-head">
        <div>
          <span className="eyebrow">Compete</span>
          <h1 className="display">Leaderboard</h1>
        </div>
        <div className="seg compact" role="group" aria-label="Period">
          <button className="chip" aria-pressed={period === "week"} onClick={() => setPeriod("week")}>
            This week
          </button>
          <button className="chip" aria-pressed={period === "season"} onClick={() => setPeriod("season")}>
            Season
          </button>
        </div>
      </section>

      {data && (
        <section className="card lb-summary">
          <div className="spread">
            <span className="muted small">Resets in {countdown(data.endsAt, now)}</span>
            {data.prize && <span className="badge gold-badge">Prize pool {formatTokens(data.prize.units)} tokens</span>}
          </div>
          {data.me && (
            <div className="lb-me">
              <span>
                <strong>{data.me.rank ? `#${data.me.rank}` : "Not ranked yet"}</strong>
                <span className="muted small">
                  {" "}
                  · {data.me.points} points · {data.me.played} online matches · {data.me.opponents} opponents
                </span>
              </span>
              {data.prize &&
                (!data.me.registered ? (
                  <span className="small">
                    Prizes need a wallet account. <WalletButton className="btn sm gold" label="Connect" />
                  </span>
                ) : !data.me.eligible ? (
                  <span className="muted small">
                    Play {Math.max(0, data.prize.minOpponents - data.me.opponents)} more different opponents to qualify for prizes.
                  </span>
                ) : (
                  <span className="small fair-ok">Eligible for this week&apos;s prizes</span>
                ))}
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            Online matches against real players: win {data.points.winPerMatchPoint} × match length, loss {data.points.loss}, +{data.points.gammonBonus} per
            gammon. Up to 3 matches a day against the same opponent count.
          </p>
        </section>
      )}

      {!data ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 18 }} />
      ) : data.rows.length === 0 ? (
        <section className="card empty">
          <p className="muted">No points yet this {period === "week" ? "week" : "season"}. Win an online match to top the board.</p>
        </section>
      ) : (
        <ol className="lb-list">
          {data.rows.map((r) => (
            <li key={r.rank} className={`${r.me ? "me " : ""}${r.prize ? "prize" : ""}`}>
              <span className={`lb-rank${r.rank <= 3 ? ` top${r.rank}` : ""}`}>{r.rank}</span>
              <Avatar name={r.name} src={r.avatarUrl} size={36} frame={r.frame} />
              <span className="lb-name">
                <strong className="ellipsis">
                  {r.name}
                  {r.me ? " (you)" : ""}
                </strong>
                <span className="muted small">
                  Lv {r.level} · {r.wins}/{r.played} won
                </span>
              </span>
              <span className="lb-points mono">{r.points}</span>
              {r.prize !== null && <span className="badge gold-badge">{formatTokens(r.prize)}</span>}
            </li>
          ))}
        </ol>
      )}

      {data?.lastWinners && (
        <section className="card">
          <h2>Last winners · week of {data.lastWinners.weekKey}</h2>
          <ul className="list">
            {data.lastWinners.winners.map((w) => (
              <li key={w.place}>
                <span>
                  #{w.place} {w.name}
                </span>
                <span className="mono">
                  {w.points} pts · {formatTokens(w.units)} tokens
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
