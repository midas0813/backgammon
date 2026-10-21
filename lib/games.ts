import { seatToAct, type MatchState } from "./engine/match";
import type { Seat } from "./engine/board";
import { seatToMove, type ChessState } from "./chess/rules";

/**
 * The games on the platform. Each match records its game; accounts, wallet, clocks, chat, lobby and
 * admin are shared, while rules, boards, ratings and XP are per game.
 */
export type GameType = "backgammon" | "chess";

export const GAMES: { id: GameType; name: string; icon: string; tagline: string }[] = [
  { id: "backgammon", name: "Backgammon", icon: "⚀", tagline: "Dice, doubling cube, match play" },
  { id: "chess", name: "Chess", icon: "♟", tagline: "Bullet, blitz and rapid" },
];

export const isGameType = (v: unknown): v is GameType => v === "backgammon" || v === "chess";

/** The seat that must act next in a match of any game (null when nobody). */
export function seatToActOf(m: { gameType?: GameType; state: MatchState; chess?: ChessState }): Seat | null {
  if (m.gameType === "chess") return m.state.status === "ACTIVE" && m.chess && !m.chess.result ? seatToMove(m.chess) : null;
  return seatToAct(m.state);
}
