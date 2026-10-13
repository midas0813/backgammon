"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ThemePicker from "@/components/ThemePicker";
import { api } from "@/lib/client/api";
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
interface Me {
  name: string;
}
interface Wallet {
  balances: { freeCredits: number; available: number };
}

const MODE_LABEL = { quick: "Quick", private: "Invite", local: "Pass & play", bot: "vs Computer" };

export default function Lobby() {
  const router = useRouter();
  const [lists, setLists] = useState<Lists | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [points, setPoints] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, l, w] = await Promise.all([api<Me>("/api/me"), api<Lists>("/api/matches"), api<Wallet>("/api/wallet")]);
      setMe(m);
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
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await api<{ matchId: string }>("/api/matches", { method: "POST", body: { mode, targetPoints: points } });
      router.push(`/match/${matchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a match");
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <header className="spread">
        <div>
          <h1>Backgammon</h1>
          <div className="muted small">{me ? `Playing as ${me.name}` : " "}</div>
        </div>
        <Link href="/wallet" className="badge" style={{ textDecoration: "none" }}>
          {wallet ? `${formatTokens(wallet.balances.available)} BGT · ${formatTokens(wallet.balances.freeCredits)} practice` : "Wallet"}
        </Link>
      </header>

      {lists && lists.mine.length > 0 && (
        <section className="card">
          <h2>Resume</h2>
          <ul className="list">
            {lists.mine.map((m) => (
              <li key={m.matchId}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        <h2>Play</h2>
        <div className="grid3" role="group" aria-label="Mode">
          <button className="chip" aria-pressed="true">
            Quick
          </button>
          <button className="chip" disabled title="Phase 2">
            Ranked · soon
          </button>
          <button className="chip" disabled title="Phase 2">
            Tournaments · soon
          </button>
        </div>
        <div className="grid2" role="group" aria-label="Entry">
          <button className="chip" aria-pressed="true">
            Free
          </button>
          <button className="chip" disabled>
            Tokens · not enabled
          </button>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Match length
          </div>
          <div className="row" role="group" aria-label="Match length">
            {[1, 3, 5, 7].map((p) => (
              <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
                {p} point{p > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="muted small">Free · doubling cube (cap 128) · Crawford rule · no clock · nothing at stake</div>
        <button className="btn primary block" disabled={busy} onClick={() => create("bot")}>
          Play vs computer
        </button>
        <button className="btn block" disabled={busy} onClick={() => create("quick")}>
          Find online opponent
        </button>
        <div className="grid2">
          <button className="btn" disabled={busy} onClick={() => create("private")}>
            Invite a friend
          </button>
          <button className="btn" disabled={busy} onClick={() => create("local")}>
            Pass &amp; play
          </button>
        </div>
        <div className="muted small">
          Online play needs a second player in a different browser, a private window or another device. Tabs in the same browser are the
          same player.
        </div>
        {error && <p className="err small">{error}</p>}
      </section>

      {lists && lists.open.length > 0 && (
        <section className="card">
          <h2>Players waiting</h2>
          <ul className="list">
            {lists.open.map((m) => (
              <li key={m.matchId}>
                <span>
                  {m.names[0]} · {m.targetPoints}-pt
                </span>
                <Link className="btn sm" href={`/match/${m.matchId}`}>
                  View
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

      <section className="notice">
        <strong>MVP build.</strong> Ranked play, tournaments and token stakes are later phases and are disabled. The wallet uses a simulated
        payment provider; development tokens have no cash value.
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
