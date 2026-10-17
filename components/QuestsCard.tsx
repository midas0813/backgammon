"use client";

import { useCallback, useEffect, useState } from "react";
import Confetti from "@/components/Confetti";
import { api, ClientApiError } from "@/lib/client/api";
import { sounds } from "@/lib/client/sound";
import { toast } from "@/lib/client/toast";
import { FRAMES } from "@/lib/quests";
import type { QuestBoard } from "@/lib/server/quests";

function timeLeft(iso: string) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`;
}

/** Level, XP and this period's quests, with Claim buttons (Home). */
export default function QuestsCard() {
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [tab, setTab] = useState<"daily" | "weekly">("daily");
  const [busy, setBusy] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(0);

  const load = useCallback(() => {
    api<QuestBoard>("/api/quests")
      .then(setBoard)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!board) return <div className="skeleton" style={{ height: 220, borderRadius: 18 }} />;
  const quests = board[tab];
  const done = (q: (typeof quests)[number]) => q.progress >= q.target;

  const claim = async (id: string) => {
    setBusy(id);
    try {
      const r = await api<{ xp: number; level: number; levelUp: boolean; credits: number }>("/api/quests/claim", { method: "POST", body: { questId: id } });
      setCelebrate((n) => n + 1);
      sounds.win();
      const unlocked = FRAMES.find((f) => f.level === r.level);
      toast(
        r.levelUp
          ? `Level ${r.level}!${unlocked ? ` New avatar frame: ${unlocked.name}.` : ""}`
          : `Quest complete${r.credits ? ` · +${r.credits / 100} practice credits` : ""}`,
        { tone: "ok" },
      );
      load();
    } catch (e) {
      toast(e instanceof ClientApiError ? e.message : "Could not claim", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card quests">
      {celebrate > 0 && <Confetti key={celebrate} pieces={60} />}
      <div className="spread">
        <h2>Quests</h2>
        <span className="level-chip">Level {board.level}</span>
      </div>
      <div className="xp-bar" aria-label={`${board.into} of ${board.span} XP to level ${board.level + 1}`}>
        <span style={{ width: `${Math.round((board.into / board.span) * 100)}%` }} />
      </div>
      <div className="muted small">
        {board.into} / {board.span} XP to level {board.level + 1}
        {!board.registered && " · connect a wallet to keep your progress and earn practice credits"}
      </div>
      <div className="seg compact" role="group" aria-label="Quest period">
        {(["daily", "weekly"] as const).map((p) => (
          <button key={p} className="chip" aria-pressed={tab === p} onClick={() => setTab(p)}>
            {p === "daily" ? "Daily" : "Weekly"}
          </button>
        ))}
        <span className="muted small quests-reset">resets in {timeLeft(quests[0]?.endsAt ?? new Date().toISOString())}</span>
      </div>
      <ul className="quest-list">
        {quests.map((q) => (
          <li key={q.id} className={q.claimed ? "claimed" : done(q) ? "ready" : ""}>
            <div className="quest-main">
              <strong>{q.title}</strong>
              <span className="muted small">
                +{q.xp} XP{board.registered && q.credits ? ` · ${q.credits / 100} credits` : ""}
              </span>
              <div className="quest-bar">
                <span style={{ width: `${Math.round((q.progress / q.target) * 100)}%` }} />
              </div>
            </div>
            {q.claimed ? (
              <span className="badge ok">Claimed</span>
            ) : done(q) ? (
              <button className="btn sm primary btn-ping" disabled={busy === q.id} onClick={() => claim(q.id)}>
                Claim
              </button>
            ) : (
              <span className="mono small">
                {q.progress}/{q.target}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
