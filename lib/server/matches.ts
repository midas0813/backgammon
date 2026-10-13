import { randomInt, randomUUID } from "node:crypto";
import {
  GameError,
  applyAction,
  cubeBlockReason,
  newMatch,
  seatToAct,
  startMatch,
  type ActionType,
  type DomainEvent,
  type Env,
  type GameAction,
} from "../engine/match";
import type { Seat } from "../engine/board";
import { read, transact, type Db, type MatchMode, type MatchRecord } from "./db";
import { ApiError, notFound } from "./errors";

const ALLOWED_POINTS = [1, 3, 5, 7];
const ACTION_TYPES: ActionType[] = ["ROLL", "CONFIRM_TURN", "OFFER_DOUBLE", "ACCEPT_DOUBLE", "PASS_DOUBLE", "FORFEIT_MATCH"];
const EVENT_RETENTION = 300;

/** Server dice: cryptographically random, never supplied by the client. */
let env: Env = { roll: () => randomInt(1, 7), newId: () => randomUUID() };
export function setEnvForTests(e: Env) {
  env = e;
}

function shortId() {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

function pushEvents(rec: MatchRecord, events: DomainEvent[]) {
  const serverTime = new Date().toISOString();
  for (const e of events) {
    rec.eventSeq += 1;
    rec.events.push({ seq: rec.eventSeq, type: e.type, stateVersion: rec.version, serverTime, payload: e.payload });
  }
  if (rec.events.length > EVENT_RETENTION) rec.events.splice(0, rec.events.length - EVENT_RETENTION);
}

function seatOf(rec: MatchRecord, userId: string): Seat[] {
  return ([0, 1] as Seat[]).filter((s) => rec.seats[s] === userId);
}

function join(db: Db, rec: MatchRecord, userId: string) {
  if (rec.state.status !== "WAITING") throw new ApiError(409, "EVENT_LOCKED", "Match already started");
  if (rec.seats[0] === userId) throw new ApiError(409, "ALREADY_SEATED", "You are already in this match");
  rec.seats[1] = userId;
  rec.names[1] = db.users[userId].name;
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_READY", payload: {} }]);
  pushEvents(rec, startMatch(rec.state, env));
}

export function createMatch(userId: string, mode: MatchMode, targetPoints: number): { matchId: string } {
  if (!ALLOWED_POINTS.includes(targetPoints)) throw new ApiError(400, "INVALID_INPUT", "Unsupported match length");
  if (!["quick", "private", "local"].includes(mode)) throw new ApiError(400, "INVALID_INPUT", "Unsupported mode");
  return transact((db) => {
    // Quick match queue: join the oldest compatible waiting match, otherwise open a new one.
    if (mode === "quick") {
      const mine = Object.values(db.matches).find(
        (m) => m.mode === "quick" && m.state.status === "WAITING" && m.seats[0] === userId,
      );
      if (mine) return { matchId: mine.id };
      const open = Object.values(db.matches)
        .filter((m) => m.mode === "quick" && m.state.status === "WAITING" && m.state.targetPoints === targetPoints)
        .filter((m) => m.seats[0] !== userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (open) {
        join(db, open, userId);
        return { matchId: open.id };
      }
    }
    const name = db.users[userId].name;
    const rec: MatchRecord = {
      id: shortId(),
      mode,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      seats: [userId, mode === "local" ? userId : null],
      names: [mode === "local" ? `${name} (White)` : name, mode === "local" ? `${name} (Black)` : "Waiting…"],
      lastSeen: [Date.now(), 0],
      version: 1,
      state: newMatch(targetPoints),
      events: [],
      eventSeq: 0,
      actions: {},
    };
    pushEvents(rec, [{ type: "MATCH_CREATED", payload: { mode, targetPoints } }]);
    if (mode === "local") {
      rec.version += 1;
      pushEvents(rec, startMatch(rec.state, env));
    }
    db.matches[rec.id] = rec;
    return { matchId: rec.id };
  });
}

export function joinMatch(userId: string, matchId: string) {
  return transact((db) => {
    const rec = db.matches[matchId];
    if (!rec) throw notFound("Match");
    if (rec.mode === "local") throw new ApiError(409, "EVENT_LOCKED", "Pass-and-play matches cannot be joined");
    join(db, rec, userId);
    return { matchId };
  });
}

export function cancelMatch(userId: string, matchId: string) {
  return transact((db) => {
    const rec = db.matches[matchId];
    if (!rec) throw notFound("Match");
    if (rec.createdBy !== userId) throw new ApiError(403, "NOT_PARTICIPANT", "Only the creator can cancel");
    if (rec.state.status !== "WAITING") throw new ApiError(409, "EVENT_LOCKED", "Match already started");
    rec.state.status = "CANCELLED";
    rec.version += 1;
    pushEvents(rec, [{ type: "MATCH_CANCELLED", payload: {} }]);
    return { matchId };
  });
}

export interface ActionRequest {
  actionId?: unknown;
  expectedVersion?: unknown;
  actionType?: unknown;
  payload?: unknown;
}

/**
 * Validate, apply and persist one game action.
 *  - Same actionId + same payload → original response (safe retry).
 *  - Same actionId + different payload → DUPLICATE_ACTION_CONFLICT.
 *  - Stale expectedVersion → STALE_VERSION with currentVersion; the client resyncs.
 */
export function submitAction(userId: string, matchId: string, req: ActionRequest) {
  const actionId = typeof req.actionId === "string" ? req.actionId : "";
  if (!actionId || actionId.length > 64) throw new ApiError(400, "INVALID_INPUT", "actionId is required");
  if (!ACTION_TYPES.includes(req.actionType as ActionType)) throw new ApiError(400, "INVALID_INPUT", "Unknown actionType");
  const action: GameAction = { actionType: req.actionType as ActionType, payload: (req.payload ?? {}) as GameAction["payload"] };
  const fingerprint = JSON.stringify([userId, action.actionType, action.payload]);

  return transact((db) => {
    const rec = db.matches[matchId];
    if (!rec) throw notFound("Match");
    const seats = seatOf(rec, userId);
    if (seats.length === 0) throw new ApiError(403, "NOT_PARTICIPANT", "You are not a player in this match");

    const prior = rec.actions[actionId];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ApiError(409, "DUPLICATE_ACTION_CONFLICT", "actionId reused with a different payload");
      return prior.response as { version: number; replayed?: boolean };
    }
    if (req.expectedVersion !== rec.version) {
      throw new ApiError(409, "STALE_VERSION", "Game state changed; refreshing", { currentVersion: rec.version });
    }

    // Pass-and-play: one user holds both seats and acts for whichever seat must act.
    const actor: Seat = seats.length === 2 ? (seatToAct(rec.state) ?? 0) : seats[0];
    let events: DomainEvent[];
    try {
      events = applyAction(rec.state, actor, action, env);
    } catch (e) {
      if (e instanceof GameError) {
        throw new ApiError(422, e.code, e.message, { currentVersion: rec.version });
      }
      throw e;
    }
    rec.version += 1;
    pushEvents(rec, events);
    const response = { version: rec.version };
    rec.actions[actionId] = { fingerprint, response };
    return response;
  });
}

const ONLINE_MS = 6000;

/** Participant-scoped snapshot. Never includes user IDs, wallets or payment data. */
export function getSnapshot(userId: string, matchId: string) {
  const now = Date.now();
  // Presence is a soft signal; record it without bumping the state version.
  const recRaw = read((db) => db.matches[matchId]);
  if (!recRaw) throw notFound("Match");
  const mySeats = seatOf(recRaw, userId);
  for (const s of mySeats) recRaw.lastSeen[s] = now;

  const rec = recRaw;
  const st = rec.state;
  const g = st.game;
  return {
    matchId: rec.id,
    mode: rec.mode,
    rulesVersion: st.rulesVersion,
    stateVersion: rec.version,
    status: st.status,
    targetPoints: st.targetPoints,
    score: st.score,
    crawfordUsed: st.crawfordUsed,
    winner: st.winner,
    endReason: st.endReason,
    results: st.results,
    seats: ([0, 1] as Seat[]).map((s) => ({
      seat: s,
      name: rec.names[s],
      occupied: rec.seats[s] !== null,
      online: rec.mode === "local" ? true : now - rec.lastSeen[s] < ONLINE_MS,
    })),
    yourSeats: mySeats,
    canJoin: st.status === "WAITING" && rec.mode !== "local" && mySeats.length === 0,
    canCancel: st.status === "WAITING" && rec.createdBy === userId,
    seatToAct: seatToAct(st),
    game: g
      ? {
          ...g,
          cubeBlock: [cubeBlockReason(st, 0), cubeBlockReason(st, 1)],
        }
      : null,
    events: rec.events.slice(-30),
    eventCursor: rec.eventSeq,
    serverNow: new Date(now).toISOString(),
  };
}

export type MatchSnapshot = ReturnType<typeof getSnapshot>;

export function listMatches(userId: string) {
  return read((db) => {
    const all = Object.values(db.matches);
    const summary = (m: MatchRecord) => ({
      matchId: m.id,
      mode: m.mode,
      status: m.state.status,
      targetPoints: m.state.targetPoints,
      names: m.names,
      score: m.state.score,
      createdAt: m.createdAt,
      yours: m.seats.includes(userId),
    });
    return {
      open: all
        .filter((m) => m.mode === "quick" && m.state.status === "WAITING" && m.seats[0] !== userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(summary),
      mine: all
        .filter((m) => m.seats.includes(userId) && (m.state.status === "ACTIVE" || m.state.status === "WAITING"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(summary),
      recent: all
        .filter((m) => m.seats.includes(userId) && m.state.status === "COMPLETED")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map(summary),
    };
  });
}
