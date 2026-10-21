import type { Chess } from "chess.js";
import { replay } from "./rules";

/**
 * The chess computer: alpha-beta search over material and piece placement, with captures searched
 * further. It uses chess.js's internal move generator (no move notation, which is the slow part)
 * and a time limit, deepening one level at a time until time runs out. Level 1 thinks briefly and
 * sometimes picks a weaker move; level 3 searches deepest. A stronger engine can replace it later.
 */
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square bonuses from White's side (a8 first), mirrored for Black.
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0,
    0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20,
    15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0,
    -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0,
    -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5,
    5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
    -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const MATE = 100_000;

/** chess.js internals (pinned version): legal moves on its 0x88 board, make and undo. */
interface IMove {
  from: number;
  to: number;
  piece: string;
  captured?: string;
  promotion?: string;
}
interface Engine {
  _moves(o: { legal: boolean }): IMove[];
  _makeMove(m: IMove): void;
  _undoMove(): unknown;
  _isKingAttacked(color: "w" | "b"): boolean;
  _board: ({ type: string; color: "w" | "b" } | undefined)[];
  _turn: "w" | "b";
}

const square = (sq: number) => "abcdefgh"[sq & 15] + "87654321"[sq >> 4];
const uci = (m: IMove) => square(m.from) + square(m.to) + (m.promotion ?? "");

/** Score from the side to move's point of view. */
function evaluate(e: Engine): number {
  let score = 0;
  const b = e._board;
  for (let sq = 0; sq < 120; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (!p) continue;
    const r = sq >> 4;
    const f = sq & 15;
    const v = VALUE[p.type] + PST[p.type][p.color === "w" ? r * 8 + f : (7 - r) * 8 + f];
    score += p.color === "w" ? v : -v;
  }
  return e._turn === "w" ? score : -score;
}

const gain = (m: IMove) => (m.captured ? VALUE[m.captured] * 10 - VALUE[m.piece] : 0) + (m.promotion ? 8000 : 0);
// Captures first (most valuable victim), then promotions: alpha-beta prunes far more that way.
const order = (moves: IMove[]) => moves.sort((a, b) => gain(b) - gain(a));

class OutOfTime extends Error {}

function makeSearch(e: Engine, deadline: number) {
  let nodes = 0;
  const tick = () => {
    if (++nodes % 512 === 0 && Date.now() > deadline) throw new OutOfTime();
  };
  const quiesce = (alpha: number, beta: number, depth: number): number => {
    tick();
    const stand = evaluate(e);
    if (stand >= beta || depth === 0) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(e._moves({ legal: true }).filter((x) => x.captured))) {
      e._makeMove(m);
      const score = -quiesce(-beta, -alpha, depth - 1);
      e._undoMove();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };
  const search = (depth: number, alpha: number, beta: number, ply: number): number => {
    tick();
    const moves = e._moves({ legal: true });
    if (moves.length === 0) return e._isKingAttacked(e._turn) ? -MATE + ply : 0;
    if (depth === 0) return quiesce(alpha, beta, 4);
    let best = -Infinity;
    for (const m of order(moves)) {
      e._makeMove(m);
      const score = -search(depth - 1, -beta, -alpha, ply + 1);
      e._undoMove();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  };
  return search;
}

const LEVELS: Record<number, { maxDepth: number; ms: number; slack: number; blunder: number }> = {
  1: { maxDepth: 1, ms: 150, slack: 120, blunder: 0.25 },
  2: { maxDepth: 3, ms: 500, slack: 25, blunder: 0 },
  3: { maxDepth: 5, ms: 1200, slack: 0, blunder: 0 },
};

/** The computer's move (UCI) for the position after `moves`, at `level` 1–3. */
export function chooseChessMove(moves: string[], level = 2, rand: () => number = Math.random): string {
  const cfg = LEVELS[Math.max(1, Math.min(3, Math.trunc(level)))];
  const c: Chess = replay(moves);
  const e = c as unknown as Engine;
  const deadline = Date.now() + cfg.ms;
  const search = makeSearch(e, deadline);
  const root = order(e._moves({ legal: true }));
  let scored = root.map((m) => ({ m, score: 0 }));
  // Deepen one level at a time; keep the last search that finished in time.
  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    try {
      const next = scored.map(({ m }) => {
        e._makeMove(m);
        try {
          return { m, score: -search(depth - 1, -Infinity, Infinity, 1) };
        } finally {
          e._undoMove();
        }
      });
      scored = next.sort((a, b) => b.score - a.score);
    } catch (err) {
      if (err instanceof OutOfTime) break;
      throw err;
    }
  }
  // Easier levels sometimes pick from the near-best moves, or an outright weaker one.
  const pool = scored.filter((s) => s.score >= scored[0].score - cfg.slack);
  const pick = rand() < cfg.blunder ? scored[Math.floor(rand() * Math.min(scored.length, 6))] : pool[Math.floor(rand() * pool.length)];
  return uci(pick.m);
}
