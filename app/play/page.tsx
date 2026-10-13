"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import ThemePicker from "@/components/ThemePicker";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { formatTokens } from "@/lib/fees";

interface MatchSummary {
  matchId: string;
  mode: "quick" | "private" | "local" | "bot";
  status: string;
  targetPoints: number;
  names: [string, string];
  score: [number, number];
}
interface Lists {
  open: MatchSummary[];
  mine: MatchSummary[];
  recent: MatchSummary[];
}
interface Wallet {
  balances: { freeCredits: number; available: number };
}

const MODE_LABEL = { quick: "Quick", private: "Invite", local: "Pass & play", bot: "vs Computer" };

const MODES = [
  {
    mode: "bot" as const,
    title: "vs Computer",
    text: "Start instantly against the house bot.",
    icon: "M5 8h14v11H5zM12 4v4M9 13h.01M15 13h.01M9 16h6",
    primary: true,
  },
  { mode: "quick" as const, title: "Online match", text: "Get paired with the next player.", icon: "M13 2 3 14h8l-1 8 10-12h-8z" },
  { mode: "private" as const, title: "Invite a friend", text: "Share a private link.", icon: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" },
  { mode: "local" as const, title: "Pass & play", text: "Two players, one device.", icon: "M7 3h10v18H7zM11 18h2" },
];

export default function Lobby() {
  const router = useRouter();
  const me = useMe();
  const [lists, setLists] = useState<Lists | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [points, setPoints] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, w] = await Promise.all([api<Lists>("/api/matches"), api<Wallet>("/api/wallet")]);
      setLists(l);
      setWallet(w);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [load]);

  const create = async (mode: MatchSummary["mode"]) => {
    setBusy(mode);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/matches", { method: "POST", body: { mode, targetPoints: points } });
      router.push(`/match/${matchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a match");
      setBusy(null);
    }
  };

  return (
    <main className="page">
      <section className="lobby-hero">
        <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
          <Avatar name={me?.name ?? "?"} src={me?.avatarUrl} size={52} />
          <div style={{ minWidth: 0 }}>
            <div className="muted small">Welcome back</div>
            <h1 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.name ?? " "}</h1>
          </div>
        </div>
        <div className="lobby-balances">
          <Link href="/wallet" className="bal">
            <span className="muted small">Tokens</span>
            <strong className="mono">{wallet ? formatTokens(wallet.balances.available) : "—"}</strong>
          </Link>
          <Link href="/wallet" className="bal">
            <span className="muted small">Practice</span>
            <strong className="mono">{wallet ? formatTokens(wallet.balances.freeCredits) : "—"}</strong>
          </Link>
        </div>
      </section>

      {me && !me.registered && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>Playing as a guest. Create an account to keep your stats, avatar and wallet on any device.</span>
          <Link className="btn sm gold" href="/signup">
            Create account
          </Link>
        </div>
      )}

      {lists && lists.mine.length > 0 && (
        <section className="card accent">
          <div className="card-title">
            <span className="badge live">Live</span>
            <h2>Resume</h2>
          </div>
          <ul className="list">
            {lists.mine.map((m) => (
              <li key={m.matchId}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.names[0]} vs {m.names[1]}
                  </div>
                  <div className="muted small">
                    {MODE_LABEL[m.mode]} · {m.targetPoints}-pt · {m.status === "WAITING" ? "waiting for opponent" : `score ${m.score[0]}–${m.score[1]}`}
                  </div>
                </div>
                <Link className="btn sm primary" href={`/match/${m.matchId}`}>
                  {m.status === "WAITING" ? "Open" : "Resume"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="spread">
          <h2>New match</h2>
          <span className="badge ok">Free</span>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Match length
          </div>
          <div className="seg" role="group" aria-label="Match length">
            {[1, 3, 5, 7].map((p) => (
              <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
                {p} pt
              </button>
            ))}
          </div>
        </div>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button key={m.mode} className={`mode-tile${m.primary ? " primary" : ""}`} disabled={!!busy} onClick={() => create(m.mode)}>
              <span className="mode-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={m.icon} />
                </svg>
              </span>
              <strong>{busy === m.mode ? "Starting…" : m.title}</strong>
              <span className="muted small">{m.text}</span>
            </button>
          ))}
        </div>
        <div className="muted small">Doubling cube (cap 128) · Crawford rule · no clock · nothing at stake</div>
        <div className="row">
          <span className="badge">Ranked · coming soon</span>
          <span className="badge">Tournaments · coming soon</span>
          <span className="badge">Token stakes · not enabled</span>
        </div>
        <p className="muted small">
          Online play needs a second player in another browser, a private window or another device. Tabs in the same browser are the same player.
        </p>
        {error && <p className="err small">{error}</p>}
      </section>

      {lists && lists.open.length > 0 && (
        <section className="card">
          <h2>Players waiting</h2>
          <ul className="list">
            {lists.open.map((m) => (
              <li key={m.matchId}>
                <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <Avatar name={m.names[0]} size={30} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.names[0]} · {m.targetPoints}-pt
                  </span>
                </span>
                <Link className="btn sm" href={`/match/${m.matchId}`}>
                  Join
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Board theme</h2>
        <ThemePicker />
      </section>

      {lists && lists.recent.length > 0 && (
        <section className="card">
          <h2>Recent results</h2>
          <ul className="list">
            {lists.recent.map((m) => (
              <li key={m.matchId}>
                <span className="small">
                  {m.names[0]} {m.score[0]}–{m.score[1]} {m.names[1]}
                </span>
                <Link className="btn sm" href={`/match/${m.matchId}`}>
                  View
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
