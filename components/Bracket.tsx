"use client";

import Link from "next/link";
import type { TournamentView } from "@/lib/server/tournaments";

const ROUND_NAME = (r: number, total: number) =>
  r === total - 1 ? "Final" : r === total - 2 ? "Semi-finals" : r === total - 3 ? "Quarter-finals" : `Round ${r + 1}`;

/** The bracket, one column per round; your matches are highlighted and open with a tap. */
export default function Bracket({ t }: { t: TournamentView }) {
  if (!t.rounds.length) return null;
  return (
    <div className="bracket" style={{ gridTemplateColumns: `repeat(${t.rounds.length}, minmax(150px, 1fr))` }}>
      {t.rounds.map((round, r) => (
        <div key={r} className="bracket-round">
          <span className="muted small">{ROUND_NAME(r, t.rounds.length)}</span>
          {round.map((s, k) => {
            const body = (
              <>
                {[s.a, s.b].map((n, i) => (
                  <span key={i} className={`bracket-player${s.winner && n === s.winner ? " won" : ""}${s.winner && n && n !== s.winner ? " out" : ""}`}>
                    {n ?? "—"}
                  </span>
                ))}
                {s.walkover && <span className="muted small">no-show</span>}
                {s.bye && <span className="muted small">bye</span>}
              </>
            );
            return s.matchId ? (
              <Link key={k} href={`/match/${s.matchId}`} className={`bracket-match${s.mine ? " mine" : ""}`}>
                {body}
              </Link>
            ) : (
              <div key={k} className="bracket-match">
                {body}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
