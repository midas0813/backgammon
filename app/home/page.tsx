"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Announcements from "@/components/Announcements";
import Avatar from "@/components/Avatar";
import CountUp from "@/components/CountUp";
import WalletButton, { shortAddress } from "@/components/WalletButton";
import { api, isHandled } from "@/lib/client/api";
import { setMe } from "@/lib/client/me";
import { formatTokens } from "@/lib/fees";
import type { HomeData } from "@/lib/server/home";
import QuestsCard from "@/components/QuestsCard";
import FriendsCard from "@/components/FriendsCard";
import TournamentsCard from "@/components/TournamentsCard";
import { GAMES, UPCOMING_GAMES, lobbyPath } from "@/lib/games";
import { levelOf } from "@/lib/quests";

const POLL_MS = 8000;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function GoalRing({ done, goal }: { done: number; goal: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const k = Math.min(1, done / goal);
  return (
    <svg className="goal-ring" viewBox="0 0 110 110" role="img" aria-label={`${done} of ${goal} matches today`}>
      <circle cx="55" cy="55" r={r} className="track" />
      <circle cx="55" cy="55" r={r} className="arc" strokeDasharray={c} strokeDashoffset={c * (1 - k)} />
      <text x="55" y="52" textAnchor="middle" className="big">
        {done}
      </text>
      <text x="55" y="71" textAnchor="middle" className="sub">
        of {goal}
      </text>
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<HomeData>(`/api/home?tz=${new Date().getTimezoneOffset()}`);
      setData(d);
      setMe(d.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: state is set after the request returns
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const playComputer = async (game: "backgammon" | "chess") => {
    setBusy(game);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/matches", {
        method: "POST",
        body: game === "chess" ? { mode: "bot", game: "chess", targetPoints: 1, botLevel: 2 } : { mode: "bot", targetPoints: 3 },
      });
      router.push(`/match/${matchId}`);
    } catch (e) {
      if (!isHandled(e)) setError(e instanceof Error ? e.message : "Could not start");
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <main className="page home">
        <div className="skeleton" style={{ height: 150, borderRadius: 22 }} />
        <div className="skeleton" style={{ height: 180, borderRadius: 18 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 18 }} />
        {error && <p className="err small">{error}</p>}
      </main>
    );
  }

  const { profile: me, balances, today, continuing, pulse } = data;
  const left = Math.max(0, today.goal - today.matches);
  const recent = me.stats.history.slice(0, 5);
  const arena = levelOf(me.xp);
  const icon = (g: string) => GAMES.find((x) => x.id === g)?.icon ?? "";

  return (
    <main className="page home">
      <Announcements />
      <section className="home-hero">
        <div className="home-id">
          <span className="home-avatar">
            <Avatar name={me.name} src={me.avatarUrl} size={64} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="muted small">{greeting()},</div>
            <h1 className="home-name">{me.name}</h1>
            <span className="arena-xp" aria-label={`${arena.into} of ${arena.span} XP to Arena level ${me.level + 1}`}>
              <span style={{ width: `${Math.round((arena.into / arena.span) * 100)}%` }} />
            </span>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <span className="badge gold-badge" title="Your Arena level: XP from every game together">
                Arena Lv {me.level}
              </span>
              {me.registered ? <span className="badge ok">Wallet account</span> : <span className="badge warn">Guest</span>}
              <span className="badge" title="Identity and age checks are not required for free play">
                Free play · not verified
              </span>
            </div>
          </div>
        </div>
        {me.walletAddress && (
          <button
            className="wallet-id home-wallet"
            onClick={() => navigator.clipboard?.writeText(me.walletAddress!).then(() => setCopied(true))}
            title="Copy wallet address"
          >
            <span className="wallet-dot" />
            <span className="mono">{shortAddress(me.walletAddress)}</span>
            <span className="muted small">{copied ? "Copied ✓" : "Copy"}</span>
          </button>
        )}
        <div className="home-balances">
          <Link href="/wallet" className="bal">
            <span className="muted small">Tokens</span>
            <strong className="mono">
              <CountUp value={balances.available} format={formatTokens} />
            </strong>
          </Link>
          <Link href="/wallet" className="bal">
            <span className="muted small">Practice</span>
            <strong className="mono">
              <CountUp value={balances.freeCredits} format={formatTokens} />
            </strong>
          </Link>
          {balances.pendingDeposits > 0 && (
            <Link href="/wallet" className="bal">
              <span className="muted small">Pending</span>
              <strong className="mono">{formatTokens(balances.pendingDeposits)}</strong>
            </Link>
          )}
        </div>
      </section>

      {!me.registered && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>Connect a wallet to keep your stats, photo and balance on any device.</span>
          <WalletButton className="btn sm gold" label="Connect Wallet" />
        </div>
      )}

      <section className="home-games" aria-label="Games">
        {data.games.map((g) => (
          <button key={g.id} className={`game-card game-${g.id}`} onClick={() => router.push(lobbyPath(g.id))}>
            <span className="game-card-icon" aria-hidden>
              {g.icon}
            </span>
            <strong>{g.name}</strong>
            <span className="muted small">
              Lv {g.level}
              {g.rated ? ` · ${g.rating}` : ""}
            </span>
            <span className="game-card-live small">
              <span className="live-dot" aria-hidden /> {g.playing} playing
            </span>
          </button>
        ))}
        <Link className="game-card soon" href="/play" aria-label={`${UPCOMING_GAMES.length} more games coming soon`}>
          <span className="game-card-icon" aria-hidden>
            {UPCOMING_GAMES.map((g) => g.icon).join("")}
          </span>
          <strong>+{UPCOMING_GAMES.length} soon</strong>
          <span className="muted small">{UPCOMING_GAMES.map((g) => g.name).join(", ")}</span>
        </Link>
      </section>

      {continuing.length > 0 && (
        <section className="card accent">
          <div className="card-title">
            <span className="badge live">Live</span>
            <h2>Continue</h2>
          </div>
          <ul className="list">
            {continuing.map((m) => (
              <li key={m.matchId} className="enter">
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 650 }}>
                    {m.status === "WAITING" ? "Your table" : `vs ${m.opponent}`}
                  </div>
                  <div className="muted small">
                    {m.gameType === "chess" ? "♟ Chess" : `⚀ Backgammon · ${m.targetPoints}-pt`} ·{" "}
                    {m.status === "WAITING" ? "waiting for an opponent" : m.gameType === "chess" ? "in progress" : `score ${m.score[0]}–${m.score[1]}`}
                  </div>
                </div>
                <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  {m.yourTurn && <span className="badge ok pulse">Your turn</span>}
                  <Link className="btn sm primary" href={`/match/${m.matchId}`} transitionTypes={["nav-forward"]}>
                    {m.status === "WAITING" ? "Open" : "Resume"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <QuestsCard />
      <TournamentsCard />
      <FriendsCard />

      <section className="card today">
        <div className="spread">
          <h2>Today</h2>
          <span className="muted small">{left === 0 ? "Daily goal reached 🎉" : `${left} more match${left === 1 ? "" : "es"} to today's goal`}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {GAMES.map((g) => (
            <span key={g.id} className="badge">
              {g.icon} {g.name} · {today.byGame[g.id] ?? 0}
            </span>
          ))}
        </div>
        <div className="today-body">
          <GoalRing done={today.matches} goal={today.goal} />
          <div className="today-stats">
            <div className="stat">
              <span className="muted small">Wins</span>
              <strong>
                <CountUp value={today.wins} />
              </strong>
            </div>
            <div className="stat">
              <span className="muted small">Losses</span>
              <strong>
                <CountUp value={today.losses} />
              </strong>
            </div>
            <div className="stat">
              <span className="muted small">Streak</span>
              <strong>
                <CountUp value={me.stats.currentStreak} />
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Quick start</h2>
        <div className="mode-grid">
          <button className="mode-tile primary" disabled={!!busy} onClick={() => playComputer("chess")}>
            <span className="mode-icon" aria-hidden>
              ♞
            </span>
            <strong>{busy === "chess" ? "Starting…" : "Chess vs Computer"}</strong>
            <span className="muted small">Medium strength, no clock</span>
          </button>
          <button className="mode-tile primary" disabled={!!busy} onClick={() => playComputer("backgammon")}>
            <span className="mode-icon" aria-hidden>
              ⚀
            </span>
            <strong>{busy === "backgammon" ? "Starting…" : "Backgammon vs Computer"}</strong>
            <span className="muted small">3-point match, starts now</span>
          </button>
          <Link className="mode-tile" href="/play">
            <span className="mode-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M13 2 3 14h8l-1 8 10-12h-8z" />
              </svg>
            </span>
            <strong>All games</strong>
            <span className="muted small">
              {pulse.open} open table{pulse.open === 1 ? "" : "s"} across the Arena
            </span>
          </Link>
          <Link className="mode-tile" href="/tournaments">
            <span className="mode-icon" aria-hidden>
              🏆
            </span>
            <strong>Tournaments</strong>
            <span className="muted small">Free sit &amp; go · Backgammon</span>
          </Link>
        </div>
        {error && <p className="err small">{error}</p>}
      </section>

      <section className="card">
        <div className="spread">
          <h2>Arena right now</h2>
          <Link className="btn sm" href="/play">
            All games →
          </Link>
        </div>
        <div className="pulse-grid">
          <div className="pulse-tile">
            <span className="live-dot" aria-hidden />
            <strong>
              <CountUp value={pulse.online} />
            </strong>
            <span className="muted small">players online</span>
          </div>
          <div className="pulse-tile">
            <strong>
              <CountUp value={pulse.live} />
            </strong>
            <span className="muted small">live matches</span>
          </div>
          <div className="pulse-tile">
            <strong>
              <CountUp value={pulse.open} />
            </strong>
            <span className="muted small">open tables</span>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="card">
          <div className="spread">
            <h2>Recent results</h2>
            <Link className="muted small" href="/profile">
              All stats →
            </Link>
          </div>
          <ul className="list">
            {recent.map((h) => (
              <li key={h.matchId}>
                <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <span className={`result-pill ${h.won ? "win" : h.reason === "draw" ? "draw" : "loss"}`}>
                    {h.won ? "W" : h.reason === "draw" ? "D" : "L"}
                  </span>
                  <span className="ellipsis">
                    {icon(h.game)} vs {h.opponent}
                  </span>
                </span>
                <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <span className="mono small">
                    {h.game === "chess" ? (h.reason === "draw" ? "draw" : h.reason === "points" ? "mate" : h.reason) : `${h.score[0]}–${h.score[1]}`}
                  </span>
                  <Link className="btn sm" href={`/match/${h.matchId}`}>
                    View
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.openReports > 0 && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>
            You have {data.openReports} open problem report{data.openReports === 1 ? "" : "s"}.
          </span>
          <Link className="btn sm" href="/profile#support">
            View
          </Link>
        </div>
      )}
    </main>
  );
}
