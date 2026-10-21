"use client";

import { useEffect, useState } from "react";
import GameIcon from "@/components/GameIcon";
import { KIND_LABEL, PLACES, formatLabel, gameName } from "@/lib/tournaments";
import type { TournamentView } from "@/lib/server/tournaments";

/** Pieces shared by the tournament list, a tournament's page and the Home card. */

/** "Sat 25 Oct, 18:00" in the viewer's own time zone. */
export const fmtStart = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "in 2d 5h", "in 14 min", "now". */
function until(ms: number) {
  if (ms <= 0) return "starting now";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A start time that counts down (minute by minute) while the page is open. */
export function StartsIn({ at }: { at: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span>
      {fmtStart(at)}
      {now !== null && <span className="muted"> · {until(Date.parse(at) - now)}</span>}
    </span>
  );
}

export function TourneyTags({ t }: { t: Pick<TournamentView, "game" | "kind" | "points" | "clock" | "timeControl"> }) {
  return (
    <span className="tourney-tags">
      <span className="tag-game">
        <GameIcon name={t.game} size={14} /> {gameName(t.game)}
      </span>
      <span className={`tag-kind kind-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
      <span className="muted small">{formatLabel(t)}</span>
    </span>
  );
}

/** Rewards per finishing place (places without a reward are left out). */
export function RewardList({ rewards }: { rewards: TournamentView["rewards"] }) {
  const rows = rewards.map((r, i) => ({ ...r, place: PLACES[i] })).filter((r) => r.xp || r.credits || r.prize);
  if (!rows.length) return null;
  return (
    <ul className="reward-list">
      {rows.map((r, i) => (
        <li key={r.place}>
          <span className={`reward-medal m${i}`} aria-hidden>
            {i + 1}
          </span>
          <span className="reward-place">{r.place}</span>
          <span className="reward-what">
            {[r.prize, r.xp && `${r.xp.toLocaleString()} XP`, r.credits && `${r.credits.toLocaleString()} credits`].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
