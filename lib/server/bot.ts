import { applyMove, countAt, other, pipCount, type Board, type Move, type Seat } from "../engine/board";

/**
 * Simple heuristic computer opponent for single-player practice. Unrated, free only.
 * It plays legal moves chosen by a static evaluation; it never offers the cube.
 */
export const BOT_USER_ID = "bot";
export const BOT_NAME = "Computer";

function evaluate(board: Board, me: Seat): number {
  const opp = other(me);
  let score = (pipCount(board, opp) - pipCount(board, me)) * 1.0;
  score += board.off[me] * 4;
  score += board.bar[opp] * 12;

  // Furthest-back opponent checker, in my numbering: blots ahead of it can be hit.
  let oppBack = board.bar[opp] > 0 ? 0 : 25;
  for (let rel = 1; rel <= 24; rel++) {
    if (countAt(board, opp, 25 - rel) > 0) {
      oppBack = Math.min(oppBack, rel);
    }
  }
  for (let rel = 1; rel <= 24; rel++) {
    const n = countAt(board, me, rel);
    if (n === 1) {
      const exposed = board.bar[opp] > 0 || rel > oppBack;
      score -= exposed ? 9 + (25 - rel) * 0.3 : 2;
    } else if (n >= 2) {
      // Made points, especially in the home board and the 7–9 blocking zone.
      score += rel <= 6 ? 6 : rel <= 9 ? 4 : 1.5;
    }
  }
  return score;
}

export function chooseSequence(board: Board, seat: Seat, sequences: Move[][]): Move[] {
  let best = sequences[0];
  let bestScore = -Infinity;
  const seen = new Set<string>();
  for (const seq of sequences) {
    const after = seq.reduce((b, m) => applyMove(b, seat, m), board);
    const key = JSON.stringify(after);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = evaluate(after, seat);
    if (s > bestScore) {
      bestScore = s;
      best = seq;
    }
  }
  return best;
}

/** Accept unless clearly behind in the race (pip count more than 15% worse). */
export function acceptsDouble(board: Board, seat: Seat): boolean {
  return pipCount(board, seat) <= pipCount(board, other(seat)) * 1.15;
}
