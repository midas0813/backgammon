import { Chess, type Move } from "chess.js";
import type { Seat } from "../engine/board";

/**
 * Chess state stored on a match (the rules themselves come from chess.js). The position is rebuilt
 * from the move list, so repetition and the 50-move rule always see the whole game. Moves are in UCI
 * form ("e2e4", "e7e8q").
 */
export type ChessEndReason = "checkmate" | "resign" | "timeout" | "abandoned" | "stalemate" | "threefold" | "fifty-moves" | "insufficient" | "agreement";

export interface ChessState {
  moves: string[];
  /** The seat playing White. */
  white: Seat;
  /** A seat's standing draw offer (cleared when the other side moves or answers). */
  drawOffer: Seat | null;
  result: { winner: Seat | null; reason: ChessEndReason } | null;
  /** "3+2" (minutes + increment seconds) or "none". */
  timeControl: string;
  /** Computer games: 1 (easy) – 3 (hard). */
  botLevel?: number;
}

export const TIME_CONTROLS = [
  { id: "1+0", label: "1+0", kind: "Bullet", baseMs: 60_000, incMs: 0 },
  { id: "3+2", label: "3+2", kind: "Blitz", baseMs: 180_000, incMs: 2_000 },
  { id: "5+0", label: "5+0", kind: "Blitz", baseMs: 300_000, incMs: 0 },
  { id: "10+0", label: "10+0", kind: "Rapid", baseMs: 600_000, incMs: 0 },
  { id: "15+10", label: "15+10", kind: "Rapid", baseMs: 900_000, incMs: 10_000 },
] as const;
export const timeControl = (id: string) => TIME_CONTROLS.find((t) => t.id === id);

export const END_LABEL: Record<ChessEndReason, string> = {
  checkmate: "by checkmate",
  resign: "by resignation",
  timeout: "on time",
  abandoned: "by abandonment",
  stalemate: "stalemate",
  threefold: "threefold repetition",
  "fifty-moves": "50-move rule",
  insufficient: "insufficient material",
  agreement: "draw agreed",
};

export const colorOf = (st: ChessState, seat: Seat): "w" | "b" => (seat === st.white ? "w" : "b");
export const seatOfColor = (st: ChessState, color: "w" | "b"): Seat => (color === "w" ? st.white : ((1 - st.white) as Seat));

const toUci = (m: Move) => `${m.from}${m.to}${m.promotion ?? ""}`;

/** The position after the stored moves. */
export function replay(moves: string[]): Chess {
  const c = new Chess();
  for (const uci of moves) c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return c;
}

/** The seat to move. */
export const seatToMove = (st: ChessState) => seatOfColor(st, (st.moves.length % 2 === 0 ? "w" : "b") as "w" | "b");

/** Play one move on `c`; returns the move in UCI form with its SAN, or null when it is illegal. */
export function tryMove(c: Chess, uci: string): { uci: string; san: string; captured: boolean } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    return { uci: toUci(m), san: m.san, captured: !!m.captured };
  } catch {
    return null;
  }
}

/** Why the game is over in this position, or null. */
export function positionEnd(c: Chess): ChessEndReason | null {
  if (c.isCheckmate()) return "checkmate";
  if (c.isStalemate()) return "stalemate";
  if (c.isInsufficientMaterial()) return "insufficient";
  if (c.isThreefoldRepetition()) return "threefold";
  if (c.isDrawByFiftyMoves()) return "fifty-moves";
  return null;
}

/** Move list in SAN, for display. */
export function sanList(moves: string[]): string[] {
  const c = new Chess();
  const out: string[] = [];
  for (const uci of moves) out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }).san);
  return out;
}
