import { randomInt, randomUUID } from "node:crypto";
import {
  GameError,
  applyAction,
  cubeBlockReason,
  currentSequences,
  newMatch,
  seatToAct,
  startMatch,
  type ActionType,
  type DomainEvent,
  type Env,
  type GameAction,
} from "../engine/match";
import type { Seat } from "../engine/board";
import { BOT_NAME, BOT_USER_ID, acceptsDouble, chooseSequence } from "./bot";
import { ApiError, notFound } from "./errors";
import { tx, type MatchMode, type MatchRecord, type Tx } from "./store";
import { avatarUrl } from "./users";

const ALLOWED_POINTS = [1, 3, 5, 7];
const ACTION_TYPES: ActionType[] = ["ROLL", "CONFIRM_TURN", "OFFER_DOUBLE", "ACCEPT_DOUBLE", "PASS_DOUBLE", "FORFEIT_MATCH"];
const EVENT_RETENTION = 300;
const ACTION_RETENTION = 400;

/** Server dice: cryptographically random, never supplied by the client. */
let env: Env = { roll: () => randomInt(1, 7), newId: () => randomUUID() };
export function setEnvForTests(e: Env) {
  env = e;
}

function shortId() {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

function pushEvents(rec: MatchRecord, events: DomainEvent[]) {
  rec.updatedAt = Date.now();
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

async function join(t: Tx, rec: MatchRecord, userId: string) {
  if (rec.state.status !== "WAITING") throw new ApiError(409, "EVENT_LOCKED", "Match already started");
  if (rec.seats[0] === userId) throw new ApiError(409, "ALREADY_SEATED", "You are already in this match");
  const user = await t.users.get(userId);
  rec.seats[1] = userId;
  rec.names[1] = user?.name ?? "Player";
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_READY", payload: {} }]);
  pushEvents(rec, startMatch(rec.state, env));
  await t.matches.put(rec);
}

export async function createMatch(userId: string, mode: MatchMode, targetPoints: number): Promise<{ matchId: string }> {
  if (!ALLOWED_POINTS.includes(targetPoints)) throw new ApiError(400, "INVALID_INPUT", "Unsupported match length");
  if (!["quick", "private", "local", "bot"].includes(mode)) throw new ApiError(400, "INVALID_INPUT", "Unsupported mode");
  return tx(async (t) => {
    // Quick match queue: join the oldest compatible waiting match, otherwise open a new one.
    if (mode === "quick") {
      const mine = (await t.matches.listForUser(userId)).find((m) => m.mode === "quick" && m.state.status === "WAITING" && m.seats[0] === userId);
      if (mine) return { matchId: mine.id };
      const open = await t.matches.nextWaitingQuick(targetPoints, userId);
      if (open) {
        await join(t, open, userId);
        return { matchId: open.id };
      }
    }
    const name = (await t.users.get(userId))?.name ?? "Player";
    const rec: MatchRecord = {
      id: shortId(),
      mode,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      seats: [userId, mode === "local" ? userId : mode === "bot" ? BOT_USER_ID : null],
      names: [
        mode === "local" ? `${name} (White)` : name,
        mode === "local" ? `${name} (Black)` : mode === "bot" ? BOT_NAME : "Waiting…",
      ],
      lastSeen: [Date.now(), 0],
      version: 1,
      state: newMatch(targetPoints),
      events: [],
      eventSeq: 0,
      actions: {},
    };
    pushEvents(rec, [{ type: "MATCH_CREATED", payload: { mode, targetPoints } }]);
    if (mode === "local" || mode === "bot") {
      rec.version += 1;
      pushEvents(rec, startMatch(rec.state, env));
    }
    await t.matches.put(rec);
    return { matchId: rec.id };
  });
}

export function joinMatch(userId: string, matchId: string) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    if (rec.mode === "local" || rec.mode === "bot") throw new ApiError(409, "EVENT_LOCKED", "This match cannot be joined");
    await join(t, rec, userId);
    return { matchId };
  });
}

export function cancelMatch(userId: string, matchId: string) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    if (rec.createdBy !== userId) throw new ApiError(403, "NOT_PARTICIPANT", "Only the creator can cancel");
    if (rec.state.status !== "WAITING") throw new ApiError(409, "EVENT_LOCKED", "Match already started");
    rec.state.status = "CANCELLED";
    rec.version += 1;
    pushEvents(rec, [{ type: "MATCH_CANCELLED", payload: {} }]);
    await t.matches.put(rec);
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
 * Validate, apply and persist one game action under a row lock on the match.
 *  - Same actionId + same payload → original response (safe retry).
 *  - Same actionId + different payload → DUPLICATE_ACTION_CONFLICT.
 *  - Stale expectedVersion → STALE_VERSION with currentVersion; the client resyncs.
 */
export async function submitAction(userId: string, matchId: string, req: ActionRequest) {
  const actionId = typeof req.actionId === "string" ? req.actionId : "";
  if (!actionId || actionId.length > 64) throw new ApiError(400, "INVALID_INPUT", "actionId is required");
  if (!ACTION_TYPES.includes(req.actionType as ActionType)) throw new ApiError(400, "INVALID_INPUT", "Unknown actionType");
  const action: GameAction = { actionType: req.actionType as ActionType, payload: (req.payload ?? {}) as GameAction["payload"] };
  const fingerprint = JSON.stringify([userId, action.actionType, action.payload]);

  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    const seats = seatOf(rec, userId);
    if (seats.length === 0) throw new ApiError(403, "NOT_PARTICIPANT", "You are not a player in this match");

    const prior = rec.actions[actionId];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ApiError(409, "DUPLICATE_ACTION_CONFLICT", "actionId reused with a different payload");
      return prior.response as { version: number };
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
      if (e instanceof GameError) throw new ApiError(422, e.code, e.message, { currentVersion: rec.version });
      throw e;
    }
    rec.version += 1;
    pushEvents(rec, events);
    const response = { version: rec.version };
    rec.actions[actionId] = { fingerprint, response };
    const ids = Object.keys(rec.actions);
    if (ids.length > ACTION_RETENTION) for (const id of ids.slice(0, ids.length - ACTION_RETENTION)) delete rec.actions[id];
    await t.matches.put(rec);
    return response;
  });
}

/**
 * Presence ("online" badge) is stored in the database so it is correct across server instances.
 * Each process writes a seat's heartbeat at most every PRESENCE_WRITE_MS to keep polling cheap.
 */
const lastPresenceWrite = ((globalThis as unknown as { __bgPresenceW?: Map<string, number> }).__bgPresenceW ??= new Map());
const PRESENCE_WRITE_MS = 3000;
const ONLINE_MS = 9000;

/** Participant-scoped snapshot. Never includes user IDs, wallets or payment data. */
export async function getSnapshot(userId: string, matchId: string) {
  const now = Date.now();
  const { rec, users, seen } = await tx(async (t) => {
    const m = await t.matches.get(matchId);
    if (!m) return { rec: undefined, users: {}, seen: [0, 0] as [number, number] };
    for (const s of seatOf(m, userId)) {
      const key = `${matchId}:${s}`;
      if (now - (lastPresenceWrite.get(key) ?? 0) >= PRESENCE_WRITE_MS) {
        await t.presence.touch(matchId, s, now);
        lastPresenceWrite.set(key, now);
      }
    }
    const ids = m.seats.filter((s) => s && s !== BOT_USER_ID) as string[];
    return { rec: m, users: await t.users.getMany(ids), seen: await t.presence.get(matchId) };
  });
  if (!rec) throw notFound("Match");
  const mySeats = seatOf(rec, userId);

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
      avatarUrl: rec.seats[s] ? avatarUrl(users[rec.seats[s]!]) : null,
      bot: rec.seats[s] === BOT_USER_ID,
      online:
        rec.mode === "local" || rec.seats[s] === BOT_USER_ID || mySeats.includes(s)
          ? true
          : now - seen[s] < ONLINE_MS,
    })),
    yourSeats: mySeats,
    canJoin: st.status === "WAITING" && rec.mode !== "local" && rec.mode !== "bot" && mySeats.length === 0,
    canCancel: st.status === "WAITING" && rec.createdBy === userId,
    seatToAct: seatToAct(st),
    game: g ? { ...g, cubeBlock: [cubeBlockReason(st, 0), cubeBlockReason(st, 1)] } : null,
    events: rec.events.slice(-30),
    eventCursor: rec.eventSeq,
    serverNow: new Date(now).toISOString(),
  };
}

export type MatchSnapshot = Awaited<ReturnType<typeof getSnapshot>>;

export function listMatches(userId: string) {
  return tx(async (t) => {
    const mineAll = await t.matches.listForUser(userId);
    const open = await t.matches.listOpenQuick(userId);
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
    const byNewest = (a: MatchRecord, b: MatchRecord) => b.createdAt.localeCompare(a.createdAt);
    return {
      open: open.map(summary),
      mine: mineAll
        .filter((m) => m.state.status === "ACTIVE" || m.state.status === "WAITING")
        .sort(byNewest)
        .map(summary),
      recent: mineAll
        .filter((m) => m.state.status === "COMPLETED")
        .sort(byNewest)
        .slice(0, 5)
        .map(summary),
    };
  });
}

const BOT_STEP_MS = 700;

/**
 * Advance the computer opponent by at most one action. Called when a participant polls, and paced so
 * players see the roll before the move. Runs through the same rules engine as human actions.
 */
export async function tickBot(matchId: string) {
  // Cheap unlocked check first: most polls are for human matches or the bot isn't due yet.
  const due = await tx(async (t) => {
    const rec = await t.matches.get(matchId);
    if (!rec || rec.mode !== "bot" || rec.state.status !== "ACTIVE") return false;
    const seat = seatToAct(rec.state);
    return seat !== null && rec.seats[seat] === BOT_USER_ID && Date.now() - (rec.updatedAt ?? 0) >= BOT_STEP_MS;
  });
  if (!due) return;
  await tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec || rec.mode !== "bot" || rec.state.status !== "ACTIVE") return;
    const seat = seatToAct(rec.state);
    if (seat === null || rec.seats[seat] !== BOT_USER_ID || Date.now() - (rec.updatedAt ?? 0) < BOT_STEP_MS) return;
    const g = rec.state.game!;
    let action: GameAction;
    if (g.phase === "BEFORE_ROLL") action = { actionType: "ROLL" };
    else if (g.phase === "CUBE_PENDING") {
      action = {
        actionType: acceptsDouble(g.board, seat) ? "ACCEPT_DOUBLE" : "PASS_DOUBLE",
        payload: { pendingOfferId: g.pendingOffer!.offerId },
      };
    } else {
      action = { actionType: "CONFIRM_TURN", payload: { moves: chooseSequence(g.board, seat, currentSequences(g)) } };
    }
    const events = applyAction(rec.state, seat, action, env);
    rec.version += 1;
    pushEvents(rec, events);
    await t.matches.put(rec);
  });
}

/** Committed events after `cursor` (spec: GET /matches/{id}/history). Participants only. */
export async function matchHistory(userId: string, matchId: string, cursor: number) {
  const rec = await tx((t) => t.matches.get(matchId));
  if (!rec) throw notFound("Match");
  if (!rec.seats.includes(userId)) throw new ApiError(403, "NOT_PARTICIPANT", "Only players can read the full history");
  const oldest = rec.events[0]?.seq ?? rec.eventSeq + 1;
  return {
    events: rec.events.filter((e) => e.seq > cursor),
    eventCursor: rec.eventSeq,
    // Events older than the retention window are gone; the client should load a fresh snapshot.
    snapshotRequired: cursor + 1 < oldest,
  };
}

/** Tests: make the bot act immediately. */
export async function forceBotDue(matchId: string) {
  await tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (rec) {
      rec.updatedAt = 0;
      await t.matches.put(rec);
    }
  });
}
