import { GameError, type DomainEvent, type GameAction } from "../engine/match";
import type { Seat } from "../engine/board";
import { colorOf, positionEnd, replay, sanList, seatToMove, tryMove, type ChessEndReason, type ChessState } from "../chess/rules";
import type { MatchRecord } from "./store";

/**
 * Chess on the shared match server. The match's `state` carries the shared fields (status, winner,
 * score, end reason) so lobby, clocks, results and admin work as for backgammon; `chess` carries the
 * moves. Draw offers stand until the other player answers or moves.
 */
export const CHESS_ACTIONS = ["MOVE", "OFFER_DRAW", "ACCEPT_DRAW", "DECLINE_DRAW", "FORFEIT_MATCH"] as const;

const other = (s: Seat) => (1 - s) as Seat;

export function startChess(rec: MatchRecord): DomainEvent[] {
  rec.state.status = "ACTIVE";
  return [{ type: "MATCH_STARTED", payload: { game: "chess", white: rec.chess!.white, timeControl: rec.chess!.timeControl } }];
}

/** End the game: `winner` null is a draw. */
export function finishChess(rec: MatchRecord, winner: Seat | null, reason: ChessEndReason): DomainEvent[] {
  const st = rec.state;
  const ch = rec.chess!;
  ch.result = { winner, reason };
  ch.drawOffer = null;
  st.status = "COMPLETED";
  st.winner = winner;
  st.endReason = reason === "resign" ? "forfeit" : reason === "timeout" || reason === "abandoned" ? reason : winner === null ? "draw" : "points";
  if (winner !== null) {
    st.score[winner] = 1;
    st.results.push({ gameNumber: 1, winner, kind: reason === "checkmate" ? "single" : "forfeit", cube: 1, points: 1, scoreAfter: [st.score[0], st.score[1]] });
  }
  return [{ type: "MATCH_COMPLETED", payload: { winner, reason, score: st.score } }];
}

/** Can `color` still checkmate with what it has left? (A lone king, or king and one minor piece, cannot.) */
function canMate(ch: ChessState, color: "w" | "b") {
  const pieces = replay(ch.moves)
    .board()
    .flat()
    .filter((p) => p && p.color === color && p.type !== "k");
  return !(pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === "b" || pieces[0]!.type === "n")));
}

/** A player lost on time or left: the opponent wins, unless the opponent could never checkmate (then a draw). */
export function chessLoss(rec: MatchRecord, loser: Seat, reason: "timeout" | "abandoned" | "resign"): DomainEvent[] {
  const ch = rec.chess!;
  const winner = other(loser);
  const draw = reason === "timeout" && !canMate(ch, colorOf(ch, winner));
  return finishChess(rec, draw ? null : winner, reason);
}

export function applyChess(rec: MatchRecord, actor: Seat, action: GameAction): DomainEvent[] {
  const ch = rec.chess;
  if (!ch || rec.state.status !== "ACTIVE" || ch.result) throw new GameError("WRONG_PHASE", "The game is not in progress");
  const p = action.payload ?? {};
  switch (action.actionType) {
    case "MOVE": {
      if (actor !== seatToMove(ch)) throw new GameError("NOT_YOUR_TURN", "It is not your move");
      const c = replay(ch.moves);
      const m = tryMove(c, p.uci ?? "");
      if (!m) throw new GameError("INVALID_MOVE_SEQUENCE", "That move is not legal");
      ch.moves.push(m.uci);
      // Moving answers an offer from the other side (declined); your own offer stands.
      if (ch.drawOffer !== null && ch.drawOffer !== actor) ch.drawOffer = null;
      const events: DomainEvent[] = [
        { type: "MOVE_MADE", payload: { seat: actor, uci: m.uci, san: m.san, ply: ch.moves.length, capture: m.captured, check: c.inCheck() } },
      ];
      const end = positionEnd(c);
      if (end) events.push(...finishChess(rec, end === "checkmate" ? actor : null, end));
      return events;
    }
    case "OFFER_DRAW": {
      if (ch.drawOffer === other(actor)) return applyChess(rec, actor, { actionType: "ACCEPT_DRAW" });
      if (ch.drawOffer === actor) throw new GameError("WRONG_PHASE", "You already offered a draw");
      if (ch.moves.length < 2) throw new GameError("WRONG_PHASE", "Make a move first");
      ch.drawOffer = actor;
      return [{ type: "DRAW_OFFERED", payload: { seat: actor } }];
    }
    case "ACCEPT_DRAW": {
      if (ch.drawOffer !== other(actor)) throw new GameError("WRONG_PHASE", "There is no draw offer to accept");
      return finishChess(rec, null, "agreement");
    }
    case "DECLINE_DRAW": {
      if (ch.drawOffer !== other(actor)) throw new GameError("WRONG_PHASE", "There is no draw offer to decline");
      ch.drawOffer = null;
      return [{ type: "DRAW_DECLINED", payload: { seat: actor } }];
    }
    case "FORFEIT_MATCH": {
      if (!p.confirm) throw new GameError("CONFIRMATION_REQUIRED", "Resigning must be confirmed");
      return chessLoss(rec, actor, "resign");
    }
  }
  throw new GameError("WRONG_PHASE", "Unknown action");
}

/** What the browser needs to draw a chess game. */
export function chessView(ch: ChessState) {
  const c = replay(ch.moves);
  return {
    fen: c.fen(),
    moves: ch.moves,
    san: sanList(ch.moves),
    white: ch.white,
    toMove: seatToMove(ch),
    inCheck: c.inCheck(),
    drawOffer: ch.drawOffer,
    result: ch.result,
    timeControl: ch.timeControl,
    botLevel: ch.botLevel ?? null,
  };
}
