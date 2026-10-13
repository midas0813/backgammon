/**
 * Canonical backgammon board and move rules (spec 02-backend "Backgammon representation" / "Rules").
 *
 * Representation
 *  - points[i] is a signed count at absolute index i (0..23). Positive = White (seat 0), negative = Black (seat 1).
 *  - Absolute index i is White's point i+1. Black's point p is absolute index 24 - p.
 *  - Each seat moves from its own point 24 toward its own point 1 and bears off past point 1.
 *  - Moves are expressed in player-relative numbers: from 25 = bar, to 0 = off.
 *
 * Screen coordinates are never used here; the board component maps relative points to pixels.
 */

export type Seat = 0 | 1;
export const WHITE: Seat = 0;
export const BLACK: Seat = 1;
export const BAR = 25;
export const OFF = 0;
export const CHECKERS_PER_SIDE = 15;

export interface Board {
  points: number[];
  bar: [number, number];
  off: [number, number];
}

export interface Move {
  from: number; // 1..24 or BAR (25)
  to: number; // 1..24 or OFF (0)
  die: number;
  hit?: boolean;
}

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function absIndex(seat: Seat, rel: number): number {
  return seat === WHITE ? rel - 1 : 24 - rel;
}

/** Number of `seat`'s checkers on its relative point `rel` (1..24). */
export function countAt(board: Board, seat: Seat, rel: number): number {
  const v = board.points[absIndex(seat, rel)];
  return seat === WHITE ? Math.max(v, 0) : Math.max(-v, 0);
}

/** Number of the opponent's checkers on `seat`'s relative point `rel`. */
export function opponentCountAt(board: Board, seat: Seat, rel: number): number {
  return countAt(board, other(seat), 25 - rel);
}

export function initialBoard(): Board {
  const board: Board = { points: new Array(24).fill(0), bar: [0, 0], off: [0, 0] };
  const setup: [number, number][] = [
    [24, 2],
    [13, 5],
    [8, 3],
    [6, 5],
  ];
  for (const seat of [WHITE, BLACK] as Seat[]) {
    for (const [rel, n] of setup) {
      board.points[absIndex(seat, rel)] += seat === WHITE ? n : -n;
    }
  }
  return board;
}

export function cloneBoard(b: Board): Board {
  return { points: b.points.slice(), bar: [b.bar[0], b.bar[1]], off: [b.off[0], b.off[1]] };
}

export function checkerTotal(board: Board, seat: Seat): number {
  let n = board.bar[seat] + board.off[seat];
  for (let rel = 1; rel <= 24; rel++) n += countAt(board, seat, rel);
  return n;
}

/** Throws if either side does not own exactly 15 checkers or a point holds both colours. */
export function assertInvariants(board: Board): void {
  for (const seat of [WHITE, BLACK] as Seat[]) {
    const total = checkerTotal(board, seat);
    if (total !== CHECKERS_PER_SIDE) throw new Error(`Checker invariant broken: seat ${seat} has ${total}`);
    if (board.bar[seat] < 0 || board.off[seat] < 0) throw new Error("Negative bar/off count");
  }
}

export function pipCount(board: Board, seat: Seat): number {
  let pips = board.bar[seat] * 25;
  for (let rel = 1; rel <= 24; rel++) pips += countAt(board, seat, rel) * rel;
  return pips;
}

export function allHome(board: Board, seat: Seat): boolean {
  if (board.bar[seat] > 0) return false;
  for (let rel = 7; rel <= 24; rel++) if (countAt(board, seat, rel) > 0) return false;
  return true;
}

/** The single-die move from `from`, or null if it is not legal on its own. */
export function tryMove(board: Board, seat: Seat, from: number, die: number): Move | null {
  if (board.bar[seat] > 0 && from !== BAR) return null;
  if (from === BAR) {
    if (board.bar[seat] === 0) return null;
  } else if (countAt(board, seat, from) === 0) {
    return null;
  }
  const to = from - die;
  if (to >= 1) {
    const opp = opponentCountAt(board, seat, to);
    if (opp >= 2) return null;
    return { from, to, die, hit: opp === 1 };
  }
  // Bearing off.
  if (!allHome(board, seat)) return null;
  if (to === 0) return { from, to: OFF, die };
  // Overshoot: only from the highest occupied point.
  for (let rel = from + 1; rel <= 6; rel++) if (countAt(board, seat, rel) > 0) return null;
  return { from, to: OFF, die };
}

export function applyMove(board: Board, seat: Seat, move: Move): Board {
  const b = cloneBoard(board);
  const sign = seat === WHITE ? 1 : -1;
  if (move.from === BAR) b.bar[seat] -= 1;
  else b.points[absIndex(seat, move.from)] -= sign;

  if (move.to === OFF) {
    b.off[seat] += 1;
  } else {
    const idx = absIndex(seat, move.to);
    // A lone opponent checker (opposite sign, magnitude 1) is hit to the bar.
    if (b.points[idx] === -sign) {
      b.points[idx] = 0;
      b.bar[other(seat)] += 1;
    }
    b.points[idx] += sign;
  }
  return b;
}

/** Remaining die uses for a roll: doubles give four. */
export function diceUses(dice: number[]): number[] {
  return dice.length === 2 && dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
}

function sources(board: Board, seat: Seat): number[] {
  if (board.bar[seat] > 0) return [BAR];
  const out: number[] = [];
  for (let rel = 24; rel >= 1; rel--) if (countAt(board, seat, rel) > 0) out.push(rel);
  return out;
}

/**
 * Every complete legal turn sequence for the remaining dice uses.
 *  - Maximum number of dice must be used.
 *  - If only one of two different dice can be used, the higher must be used when possible.
 * Returns [[]] when no move is possible (forced pass).
 */
export function legalSequences(board: Board, seat: Seat, uses: number[]): Move[][] {
  const results: Move[][] = [];
  const rec = (b: Board, remaining: number[], path: Move[]) => {
    let moved = false;
    const triedDice = new Set<number>();
    for (let i = 0; i < remaining.length; i++) {
      const die = remaining[i];
      if (triedDice.has(die)) continue;
      triedDice.add(die);
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      for (const from of sources(b, seat)) {
        const m = tryMove(b, seat, from, die);
        if (!m) continue;
        moved = true;
        rec(applyMove(b, seat, m), rest, [...path, m]);
      }
    }
    if (!moved) results.push(path);
  };
  rec(board, uses, []);

  const max = Math.max(...results.map((r) => r.length));
  let legal = results.filter((r) => r.length === max);
  if (max === 1 && uses.length === 2 && uses[0] !== uses[1]) {
    const high = Math.max(uses[0], uses[1]);
    if (legal.some((s) => s[0].die === high)) legal = legal.filter((s) => s[0].die === high);
  }
  return legal;
}

export const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && a.die === b.die;

function isPrefix(prefix: Move[], seq: Move[]): boolean {
  if (prefix.length > seq.length) return false;
  for (let i = 0; i < prefix.length; i++) if (!sameMove(prefix[i], seq[i])) return false;
  return true;
}

/** Moves that may legally follow a tentative draft. */
export function nextMoves(sequences: Move[][], draft: Move[]): Move[] {
  const out: Move[] = [];
  for (const seq of sequences) {
    if (seq.length <= draft.length || !isPrefix(draft, seq)) continue;
    const m = seq[draft.length];
    if (!out.some((o) => sameMove(o, m))) out.push(m);
  }
  return out;
}

/** The matching legal sequence (with hit flags) if `moves` is a complete legal turn. */
export function matchSequence(sequences: Move[][], moves: Move[]): Move[] | null {
  return sequences.find((s) => s.length === moves.length && isPrefix(moves, s)) ?? null;
}

export type OutcomeKind = "single" | "gammon" | "backgammon";

export function classifyOutcome(board: Board, winner: Seat): { kind: OutcomeKind; multiplier: 1 | 2 | 3 } {
  const loser = other(winner);
  if (board.off[loser] > 0) return { kind: "single", multiplier: 1 };
  let inWinnersHome = board.bar[loser] > 0;
  // Winner's home (winner rel 1..6) is the loser's rel 19..24.
  for (let rel = 19; rel <= 24; rel++) if (countAt(board, loser, rel) > 0) inWinnersHome = true;
  return inWinnersHome ? { kind: "backgammon", multiplier: 3 } : { kind: "gammon", multiplier: 2 };
}
