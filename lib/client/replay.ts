import type { Move, Seat } from "@/lib/engine/board";

export interface AnimSpec {
  key: string;
  moves: (Move & { seat: Seat })[];
}

interface GameLike {
  gameNumber: number;
  turnNumber: number;
  lastTurn: { seat: Seat; moves: Move[]; forced?: boolean } | null;
}

/**
 * What the board should animate after a new snapshot. `anim` is undefined when nothing changed
 * (keep whatever is playing), null to stop any previous animation, or the opponent's new turn.
 * A turn is animated once: never on first load, never our own, and a forced pass (no moves)
 * clears the previous animation instead of leaving it to be replayed.
 */
export function opponentAnimation(prevKey: string | null, game: GameLike | null, yourSeats: Seat[]): { key: string | null; anim: AnimSpec | null | undefined } {
  const lt = game?.lastTurn;
  if (!game || !lt) return { key: prevKey ?? "", anim: prevKey === null ? undefined : null };
  const key = `${game.gameNumber}:${game.turnNumber}:${lt.seat}`;
  if (prevKey === null) return { key, anim: undefined };
  if (prevKey === key) return { key, anim: undefined };
  const mine = yourSeats.length === 1 && yourSeats[0] === lt.seat;
  if (mine || lt.moves.length === 0) return { key, anim: null };
  return { key, anim: { key, moves: lt.moves.map((m) => ({ ...m, seat: lt.seat })) } };
}
