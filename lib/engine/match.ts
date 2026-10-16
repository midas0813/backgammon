/**
 * Match and game state machine (spec 02-backend "State machines" and "Cube").
 * Pure: dice come from an injected `roll` function so tests can be deterministic.
 */
import { Board, Move, Seat, applyMove, assertInvariants, classifyOutcome, diceUses, initialBoard, legalSequences, matchSequence, other } from "./board";

export const RULES_VERSION = "bg-rules-1.0";
export const CUBE_CAP = 128; // proposed house rule; offer to 256 is rejected

export type GamePhase = "BEFORE_ROLL" | "ROLLED" | "CUBE_PENDING";
export type MatchStatus = "WAITING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "VOIDED";
export type ResultKind = "single" | "gammon" | "backgammon" | "pass" | "forfeit";

export interface GameResult {
  gameNumber: number;
  winner: Seat;
  kind: ResultKind;
  cube: number;
  points: number;
  scoreAfter: [number, number];
}

export interface PendingOffer {
  offerId: string;
  from: Seat;
  proposed: number;
}

export interface TurnRecord {
  seat: Seat;
  dice: number[];
  moves: Move[];
  forced: boolean;
}

export interface GameState {
  gameNumber: number;
  board: Board;
  phase: GamePhase;
  turn: Seat;
  dice: number[] | null;
  openingRolls: [number, number][];
  turnNumber: number;
  cubeValue: number;
  cubeOwner: Seat | null;
  pendingOffer: PendingOffer | null;
  crawford: boolean;
  lastTurn: TurnRecord | null;
}

export interface MatchState {
  status: MatchStatus;
  rulesVersion: string;
  targetPoints: number;
  score: [number, number];
  crawfordUsed: boolean;
  game: GameState | null;
  results: GameResult[];
  winner: Seat | null;
  endReason: "points" | "forfeit" | "abandoned" | null;
}

export type ActionType = "ROLL" | "CONFIRM_TURN" | "OFFER_DOUBLE" | "ACCEPT_DOUBLE" | "PASS_DOUBLE" | "FORFEIT_MATCH";

export interface GameAction {
  actionType: ActionType;
  payload?: {
    moves?: Move[];
    proposedCube?: number;
    pendingOfferId?: string;
    confirm?: boolean;
  };
}

export type ErrorCode =
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "INVALID_MOVE_SEQUENCE"
  | "CUBE_NOT_OWNED"
  | "CUBE_CAPPED"
  | "CRAWFORD_CUBE_DISABLED"
  | "CUBE_DEAD"
  | "INVALID_CUBE_VALUE"
  | "CONFIRMATION_REQUIRED";

export class GameError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** A domain event produced by an action; the server stores and broadcasts these. */
export interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface Env {
  roll: () => number; // uniform 1..6
  newId: () => string;
}

export function newMatch(targetPoints: number): MatchState {
  return {
    status: "WAITING",
    rulesVersion: RULES_VERSION,
    targetPoints,
    score: [0, 0],
    crawfordUsed: false,
    game: null,
    results: [],
    winner: null,
    endReason: null,
  };
}

export function startMatch(m: MatchState, env: Env): DomainEvent[] {
  if (m.status !== "WAITING") throw new GameError("WRONG_PHASE", "Match already started");
  m.status = "ACTIVE";
  return [{ type: "MATCH_STARTED", payload: { targetPoints: m.targetPoints } }, ...startGame(m, env)];
}

function startGame(m: MatchState, env: Env): DomainEvent[] {
  const gameNumber = m.results.length + 1;
  let crawford = false;
  if (!m.crawfordUsed && m.targetPoints > 1 && m.score.some((s) => s === m.targetPoints - 1)) {
    crawford = true;
    m.crawfordUsed = true;
  }
  // Opening: one die each, ties are rerolled, higher die moves first with both dice.
  const openingRolls: [number, number][] = [];
  let w: number, b: number;
  do {
    w = env.roll();
    b = env.roll();
    openingRolls.push([w, b]);
  } while (w === b);
  const turn: Seat = w > b ? 0 : 1;
  m.game = {
    gameNumber,
    board: initialBoard(),
    phase: "ROLLED",
    turn,
    dice: [w, b],
    openingRolls,
    turnNumber: 1,
    cubeValue: 1,
    cubeOwner: null,
    pendingOffer: null,
    crawford,
    lastTurn: null,
  };
  return [{ type: "OPENING_ROLL_COMMITTED", payload: { gameNumber, openingRolls, firstSeat: turn, crawford } }];
}

/** Why `seat` cannot offer the cube right now, or null if it can. Phase/turn are checked separately. */
export function cubeBlockReason(m: MatchState, seat: Seat): ErrorCode | null {
  const g = m.game;
  if (!g) return "WRONG_PHASE";
  if (g.crawford) return "CRAWFORD_CUBE_DISABLED";
  if (g.cubeOwner !== null && g.cubeOwner !== seat) return "CUBE_NOT_OWNED";
  if (g.cubeValue * 2 > CUBE_CAP) return "CUBE_CAPPED";
  // Dead cube: the player already wins the match by winning this game at the current value.
  if (m.targetPoints - m.score[seat] <= g.cubeValue) return "CUBE_DEAD";
  return null;
}

export function currentSequences(g: GameState): Move[][] {
  if (g.phase !== "ROLLED" || !g.dice) return [[]];
  return legalSequences(g.board, g.turn, diceUses(g.dice));
}

/** The seat that must act next (recipient during a cube decision, otherwise the player on turn). */
export function seatToAct(m: MatchState): Seat | null {
  const g = m.game;
  if (m.status !== "ACTIVE" || !g) return null;
  if (g.phase === "CUBE_PENDING" && g.pendingOffer) return other(g.pendingOffer.from);
  return g.turn;
}

function endGame(m: MatchState, env: Env, winner: Seat, kind: ResultKind, points: number): DomainEvent[] {
  const g = m.game!;
  m.score[winner] += points;
  const result: GameResult = {
    gameNumber: g.gameNumber,
    winner,
    kind,
    cube: g.cubeValue,
    points,
    scoreAfter: [m.score[0], m.score[1]],
  };
  m.results.push(result);
  const events: DomainEvent[] = [{ type: "GAME_COMPLETED", payload: { ...result } }];
  if (m.score[winner] >= m.targetPoints) {
    m.status = "COMPLETED";
    m.winner = winner;
    m.endReason = "points";
    events.push({ type: "MATCH_COMPLETED", payload: { winner, score: result.scoreAfter, reason: "points" } });
    return events;
  }
  return [...events, ...startGame(m, env)];
}

/** After a roll, pass the turn automatically if there is no legal move (announced as forced). */
function autoPassIfBlocked(m: MatchState): DomainEvent[] {
  const g = m.game!;
  const seqs = currentSequences(g);
  if (seqs.length === 1 && seqs[0].length === 0) {
    const record: TurnRecord = { seat: g.turn, dice: g.dice!, moves: [], forced: true };
    passTurn(g, record);
    return [{ type: "TURN_COMMITTED", payload: { ...record } }];
  }
  return [];
}

function passTurn(g: GameState, record: TurnRecord) {
  g.lastTurn = record;
  g.turn = other(g.turn);
  g.phase = "BEFORE_ROLL";
  g.dice = null;
  g.turnNumber += 1;
}

/**
 * Apply an action by `actor`. Mutates `m` only on success (callers should pass a copy if they need
 * all-or-nothing semantics; the server does). Returns the domain events produced.
 */
export function applyAction(m: MatchState, actor: Seat, action: GameAction, env: Env): DomainEvent[] {
  if (m.status !== "ACTIVE" || !m.game) throw new GameError("WRONG_PHASE", "Match is not active");
  const g = m.game;
  const p = action.payload ?? {};

  if (action.actionType === "FORFEIT_MATCH") {
    if (!p.confirm) throw new GameError("CONFIRMATION_REQUIRED", "Forfeit must be explicitly confirmed");
    const winner = other(actor);
    m.results.push({
      gameNumber: g.gameNumber,
      winner,
      kind: "forfeit",
      cube: g.cubeValue,
      points: 0,
      scoreAfter: [m.score[0], m.score[1]],
    });
    m.status = "COMPLETED";
    m.winner = winner;
    m.endReason = "forfeit";
    return [{ type: "MATCH_COMPLETED", payload: { winner, score: m.score, reason: "forfeit" } }];
  }

  if (actor !== seatToAct(m)) throw new GameError("NOT_YOUR_TURN", "It is not your turn to act");

  switch (action.actionType) {
    case "ROLL": {
      if (g.phase !== "BEFORE_ROLL") throw new GameError("WRONG_PHASE", "You cannot roll now");
      g.dice = [env.roll(), env.roll()];
      g.phase = "ROLLED";
      return [{ type: "DICE_ROLLED", payload: { seat: actor, dice: g.dice } }, ...autoPassIfBlocked(m)];
    }
    case "CONFIRM_TURN": {
      if (g.phase !== "ROLLED") throw new GameError("WRONG_PHASE", "Roll before moving");
      const moves = (p.moves ?? []).map((mv) => ({ from: Number(mv.from), to: Number(mv.to), die: Number(mv.die) }));
      const seq = matchSequence(currentSequences(g), moves);
      if (!seq) throw new GameError("INVALID_MOVE_SEQUENCE", "That is not a complete legal turn");
      let board = g.board;
      for (const mv of seq) board = applyMove(board, actor, mv);
      assertInvariants(board);
      g.board = board;
      const record: TurnRecord = { seat: actor, dice: g.dice!, moves: seq, forced: false };
      const events: DomainEvent[] = [{ type: "TURN_COMMITTED", payload: { ...record } }];
      if (board.off[actor] === 15) {
        g.lastTurn = record;
        const { kind, multiplier } = classifyOutcome(board, actor);
        return [...events, ...endGame(m, env, actor, kind, g.cubeValue * multiplier)];
      }
      passTurn(g, record);
      return events;
    }
    case "OFFER_DOUBLE": {
      if (g.phase !== "BEFORE_ROLL") throw new GameError("WRONG_PHASE", "Double only before rolling");
      const reason = cubeBlockReason(m, actor);
      if (reason) throw new GameError(reason, "Doubling is not available");
      if (p.proposedCube !== g.cubeValue * 2) throw new GameError("INVALID_CUBE_VALUE", "Proposed cube must be current × 2");
      g.pendingOffer = { offerId: env.newId(), from: actor, proposed: g.cubeValue * 2 };
      g.phase = "CUBE_PENDING";
      return [{ type: "CUBE_OFFERED", payload: { ...g.pendingOffer } }];
    }
    case "ACCEPT_DOUBLE":
    case "PASS_DOUBLE": {
      if (g.phase !== "CUBE_PENDING" || !g.pendingOffer) throw new GameError("WRONG_PHASE", "No cube offer pending");
      if (p.pendingOfferId !== g.pendingOffer.offerId) throw new GameError("WRONG_PHASE", "Offer is no longer current");
      const offer = g.pendingOffer;
      g.pendingOffer = null;
      if (action.actionType === "ACCEPT_DOUBLE") {
        g.cubeValue = offer.proposed;
        g.cubeOwner = actor;
        g.phase = "BEFORE_ROLL"; // back to the offering player's turn
        return [{ type: "CUBE_ACCEPTED", payload: { cube: g.cubeValue, owner: actor } }];
      }
      // Pass awards the previously accepted value, never the proposed value or gammon multiples.
      return [{ type: "CUBE_PASSED", payload: { cube: g.cubeValue } }, ...endGame(m, env, offer.from, "pass", g.cubeValue)];
    }
  }
  throw new GameError("WRONG_PHASE", "Unknown action");
}
