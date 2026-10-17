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
import { tx, type ClosedReason, type MatchMode, type MatchRecord, type MatchResultRow, type StoredEvent, type Tx, type User } from "./store";
import { SPECTATOR_WINDOW_MS } from "./store/types";
import { newClock, nextDecision, noteReturn, timedOut, clockView, type ClockPreset } from "./clock";
import { cleanSeed } from "../fair";
import { fairView, newFair, nextDie } from "./fair";
import { levelOf } from "../quests";
import { recordProgress } from "./quests";
import { publish } from "./realtime";
import { operatorSettings } from "./settings";
import { GUEST_IDLE_MS, assertActive, avatarUrl } from "./users";

const ALLOWED_POINTS = [1, 3, 5, 7];
const ACTION_TYPES: ActionType[] = ["ROLL", "CONFIRM_TURN", "OFFER_DOUBLE", "ACCEPT_DOUBLE", "PASS_DOUBLE", "FORFEIT_MATCH"];

/** Tests only: scripted or seeded dice instead of each match's provably fair dice. */
let testEnv: Env | null = null;
export function setEnvForTests(e: Env | null) {
  testEnv = e;
}

/**
 * Dice for one match: derived from the match's sealed server seed and the players' device seeds, so
 * they can be verified afterwards (lib/fair.ts). Never supplied by the client.
 */
function envFor(rec: MatchRecord): Env {
  if (testEnv) return testEnv;
  const fair = rec.fair;
  return { roll: fair ? () => nextDie(fair) : () => randomInt(1, 7), newId: () => randomUUID() };
}

function shortId() {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

/** Append events; `put` stores them in the match's event log. */
function pushEvents(rec: MatchRecord, events: DomainEvent[]) {
  rec.updatedAt = Date.now();
  const serverTime = new Date().toISOString();
  for (const e of events) {
    rec.eventSeq += 1;
    rec.events.push({ seq: rec.eventSeq, type: e.type, stateVersion: rec.version, serverTime, payload: e.payload });
  }
  if (rec.state.status === "COMPLETED" && !rec.completedAt) rec.completedAt = serverTime;
}

function seatOf(rec: MatchRecord, userId: string): Seat[] {
  return ([0, 1] as Seat[]).filter((s) => rec.seats[s] === userId);
}

const isHuman = (id: string | null): id is string => !!id && id !== BOT_USER_ID;

/** One row per human player of a finished match (pass & play has no opponent to count). */
function resultRows(rec: MatchRecord): MatchResultRow[] {
  if (rec.mode === "local" || rec.state.status !== "COMPLETED") return [];
  const st = rec.state;
  return ([0, 1] as Seat[])
    .filter((s) => isHuman(rec.seats[s]))
    .map((s) => {
      const opp = (1 - s) as Seat;
      const mine = st.results.filter((r) => r.winner === s);
      return {
        matchId: rec.id,
        userId: rec.seats[s]!,
        mode: rec.mode,
        won: st.winner === s,
        points: mine.reduce((n, r) => n + r.points, 0),
        games: st.results.length,
        gammons: mine.filter((r) => r.kind === "gammon" || r.kind === "backgammon").length,
        opponent: rec.names[opp],
        opponentId: isHuman(rec.seats[opp]) ? rec.seats[opp] : null,
        score: [st.score[s], st.score[opp]],
        targetPoints: st.targetPoints,
        endReason: st.endReason ?? "points",
        completedAt: rec.completedAt ?? new Date().toISOString(),
      };
    });
}

/** Save a match, recording finished games and, when it ends, each player's result. */
async function save(t: Tx, rec: MatchRecord) {
  // The clock follows whoever must decide next; a finished decision is charged to its bank.
  if (rec.clock) {
    const next = rec.state.status === "ACTIVE" ? seatToAct(rec.state) : null;
    if (next !== rec.clock.seat) nextDecision(rec.clock, next, Date.now());
  }
  const games = rec.events.filter((e) => e.type === "GAME_COMPLETED").length;
  if (games) await t.counters.add("games", games);
  if (rec.events.some((e) => e.type === "MATCH_COMPLETED")) await t.results.put(resultRows(rec));
  await recordProgress(t, rec);
  await t.matches.put(rec);
  const version = rec.version;
  t.afterCommit(() => publish(rec.id, "match", { v: version }));
}

// ---- Timing rules -------------------------------------------------------------------------------

/** A public table is "listed" while its host has been seen this recently; "host online" is fresher. */
export const TABLE_EXPIRY_MS = 15 * 60 * 1000;
/** An invite-only table closes if nobody accepts within this time. */
export const INVITE_EXPIRY_MS = 15 * 60 * 1000;
/** A public table closes after this long even with the host around, so forgotten tables don't pile up. */
export const TABLE_MAX_MS = 60 * 60 * 1000;
export const HOST_ONLINE_MS = 30 * 1000;
/** After someone joins, the host has this long to come back before the match is called off. */
export const HOST_RETURN_MS = 2 * 60 * 1000;
/** The player to act, gone this long while the opponent is still there, loses by abandonment. */
export const ABANDON_MS = 10 * 60 * 1000;
const OPPONENT_PRESENT_MS = 2 * 60 * 1000;
/** Both players gone this long: closed with no result. */
export const BOTH_GONE_MS = 30 * 60 * 1000;
/** Computer and pass & play games left alone this long close with no result. */
export const OFFLINE_GAME_MS = 24 * 60 * 60 * 1000;

const online = (rec: Pick<MatchRecord, "mode">) => rec.mode === "quick" || rec.mode === "private";

type Settlement = { kind: "expire" } | { kind: "close"; reason: ClosedReason } | { kind: "abandon"; loser: Seat } | { kind: "timeout"; loser: Seat };

/** What, if anything, should happen to a match left alone. Pure: `seen` is each seat's last poll (ms). */
export function settlementFor(rec: MatchRecord, seen: [number, number], now: number): Settlement | null {
  const st = rec.state;
  const created = Date.parse(rec.createdAt);
  if (st.status === "WAITING") {
    if (rec.mode === "private") return now - created >= INVITE_EXPIRY_MS ? { kind: "expire" } : null;
    if (rec.mode === "quick") {
      const hostSeen = seen[0] || created;
      return now - hostSeen >= TABLE_EXPIRY_MS || now - created >= TABLE_MAX_MS ? { kind: "expire" } : null;
    }
    return null;
  }
  if (st.status !== "ACTIVE") return null;
  const idle = now - (rec.updatedAt ?? created);
  if (!online(rec)) return idle >= OFFLINE_GAME_MS ? { kind: "close", reason: "inactive" } : null;
  if (rec.startedAt && seen[0] < rec.startedAt && now - rec.startedAt >= HOST_RETURN_MS) return { kind: "close", reason: "host-missing" };
  // The host has not been back since someone joined: the 2-minute rule above applies, not the clock.
  const hostPending = !!rec.startedAt && seen[0] < rec.startedAt;
  if (rec.clock && !hostPending) {
    const loser = timedOut(rec.clock, seen, now);
    if (loser !== null) return { kind: "timeout", loser };
  }
  const toAct = seatToAct(st);
  // With a clock, running out of time replaces the 10-minute abandonment rule.
  if (!rec.clock && toAct !== null && idle >= ABANDON_MS && now - seen[toAct] >= ABANDON_MS && now - seen[1 - toAct] < OPPONENT_PRESENT_MS) {
    return { kind: "abandon", loser: toAct };
  }
  if (idle >= BOTH_GONE_MS && now - Math.max(seen[0], seen[1]) >= BOTH_GONE_MS) return { kind: "close", reason: "abandoned" };
  return null;
}

function closeNoResult(rec: MatchRecord, reason: ClosedReason) {
  rec.state.status = "CANCELLED";
  rec.closedReason = reason;
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_CANCELLED", payload: { reason } }]);
}

/** Apply the timing rules to one match under its row lock. Returns true if it changed. */
export async function settleIn(t: Tx, matchId: string, now = Date.now()) {
  const rec = await t.matches.get(matchId, { lock: true });
  if (!rec) return false;
  const s = settlementFor(rec, await t.presence.get(matchId), now);
  if (!s) return false;
  if (s.kind === "expire") closeNoResult(rec, "expired");
  else if (s.kind === "close") closeNoResult(rec, s.reason);
  else {
    const reason = s.kind === "timeout" ? "timeout" : "abandoned";
    const events = applyAction(rec.state, s.loser, { actionType: "FORFEIT_MATCH", payload: { confirm: true } }, envFor(rec));
    rec.state.endReason = reason;
    for (const e of events) if (e.type === "MATCH_COMPLETED") e.payload.reason = reason;
    rec.version += 1;
    pushEvents(rec, events);
  }
  await save(t, rec);
  return true;
}

/**
 * Housekeeping for matches nobody is looking at: closes stale tables and settles left games. Runs at
 * most every 30 s per server instance from busy endpoints, and from the daily cron.
 */
const lastSweep = ((globalThis as unknown as { __bgSweep?: { at: number; pruned: number; guests: number } }).__bgSweep ??= { at: 0, pruned: 0, guests: 0 });
export async function sweep(now = Date.now(), force = false) {
  if (!force && now - lastSweep.at < 30_000) return 0;
  lastSweep.at = now;
  const ids = await tx(async (t) => [
    ...(await t.matches.staleTables({
      privateBefore: now - INVITE_EXPIRY_MS,
      hostSeenBefore: now - TABLE_EXPIRY_MS,
      publicBefore: now - TABLE_MAX_MS,
      limit: 100,
    })),
    ...(await t.matches.idleActive({
      onlineBefore: now - HOST_RETURN_MS,
      awayBefore: now - OPPONENT_PRESENT_MS,
      offlineBefore: now - OFFLINE_GAME_MS,
      limit: 100,
    })),
  ]);
  let changed = 0;
  for (const id of ids) if (await tx((t) => settleIn(t, id, now))) changed++;
  if (now - lastSweep.guests > 5 * 60_000) {
    lastSweep.guests = now;
    await tx((t) => t.users.deleteInactiveGuests(now - GUEST_IDLE_MS, 200));
  }
  if (now - lastSweep.pruned > 60 * 60_000) {
    lastSweep.pruned = now;
    await tx(async (t) => {
      await t.rateLimits.prune(now - 24 * 60 * 60_000);
      await t.errors.prune(now - 30 * 24 * 60 * 60_000);
    });
  }
  return changed;
}

// ---- One game at a time -------------------------------------------------------------------------

export interface CurrentGame {
  matchId: string;
  mode: MatchMode;
  status: string;
  opponent: string | null;
  host: boolean;
}

/**
 * A player has at most one game: a table they host, an online match, or a computer or pass & play
 * game. Serialised per player, so two tabs cannot both start one.
 */
export async function assertNoOtherGame(t: Tx, userId: string, except?: string) {
  await t.lock(`player:${userId}`);
  for (const m of await t.matches.listOpen(userId, 5)) {
    if (m.id === except) continue;
    if (await settleIn(t, m.id)) continue; // it had already timed out
    const seat = m.seats[0] === userId ? 0 : 1;
    const current: CurrentGame = {
      matchId: m.id,
      mode: m.mode,
      status: m.status,
      opponent: m.mode === "local" || m.status === "WAITING" ? null : m.names[1 - seat],
      host: m.hostId === userId,
    };
    throw new ApiError(409, "ALREADY_IN_GAME", "You're already in a game. Finish or leave it first.", { current });
  }
}

export async function join(t: Tx, rec: MatchRecord, userId: string, clientSeed?: unknown) {
  if (rec.state.status !== "WAITING") throw new ApiError(409, "EVENT_FULL", "Someone just took this seat");
  if (rec.seats[0] === userId) throw new ApiError(409, "ALREADY_SEATED", "You are already in this match");
  const user = await t.users.get(userId);
  assertActive(user);
  await assertNoOtherGame(t, userId, rec.id);
  rec.seats[1] = userId;
  // The joiner's device seed goes in before the first roll.
  if (rec.fair) rec.fair.clientSeeds[1] = cleanSeed(clientSeed);
  rec.names[1] = user?.name ?? "Player";
  rec.startedAt = Date.now();
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_READY", payload: {} }]);
  pushEvents(rec, startMatch(rec.state, envFor(rec)));
  await save(t, rec);
  await t.presence.touch(rec.id, 1, Date.now()); // the joiner is here
}

export async function createMatch(
  userId: string,
  mode: MatchMode,
  targetPoints: number,
  opts: { allowSpectators?: boolean; spectatorChat?: boolean; spectatorEmoji?: boolean; clock?: ClockPreset; clientSeed?: unknown } = {},
): Promise<{ matchId: string }> {
  if (!ALLOWED_POINTS.includes(targetPoints)) throw new ApiError(400, "INVALID_INPUT", "Unsupported match length");
  if (!["quick", "private", "local", "bot"].includes(mode)) throw new ApiError(400, "INVALID_INPUT", "Unsupported mode");
  return tx(async (t) => {
    const settings = await operatorSettings(t);
    if (settings.maintenance.enabled) throw new ApiError(503, "SERVICE_UNAVAILABLE", settings.maintenance.message);
    const user = await t.users.get(userId);
    assertActive(user);
    await assertNoOtherGame(t, userId);
    const name = user?.name ?? "Player";
    const rec: MatchRecord = {
      id: shortId(),
      mode,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      seats: [userId, mode === "local" ? userId : mode === "bot" ? BOT_USER_ID : null],
      names: [mode === "local" ? `${name} (White)` : name, mode === "local" ? `${name} (Black)` : mode === "bot" ? BOT_NAME : "Waiting…"],
      lastSeen: [Date.now(), 0],
      version: 1,
      state: newMatch(targetPoints),
      events: [],
      eventSeq: 0,
      actions: {},
      allowSpectators: opts.allowSpectators !== false,
      // Online matches get a clock (standard unless the host chose otherwise); computer and pass & play none.
      clock: mode === "quick" || mode === "private" ? newClock(opts.clock ?? "standard", targetPoints) : undefined,
      fair: newFair(opts.clientSeed),
      spectatorChat: opts.spectatorChat !== false,
      spectatorEmoji: opts.spectatorEmoji !== false,
    };
    pushEvents(rec, [{ type: "MATCH_CREATED", payload: { mode, targetPoints } }]);
    if (mode === "local" || mode === "bot") {
      rec.version += 1;
      pushEvents(rec, startMatch(rec.state, envFor(rec)));
    }
    await save(t, rec);
    if (online(rec)) await t.presence.touch(rec.id, 0, Date.now());
    return { matchId: rec.id };
  });
}

export function joinMatch(userId: string, matchId: string, clientSeed?: unknown) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    if (!online(rec)) throw new ApiError(409, "EVENT_LOCKED", "This match cannot be joined");
    if (rec.state.status === "WAITING" && settlementFor(rec, await t.presence.get(matchId), Date.now())) {
      throw new ApiError(409, "EVENT_FULL", "This table has closed");
    }
    await join(t, rec, userId, clientSeed);
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
    await save(t, rec);
    return { matchId };
  });
}

/**
 * Leave a game so another can start: closes a waiting table, ends a computer or pass & play game
 * with no result, and forfeits an online match.
 */
export function leaveMatch(userId: string, matchId: string) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    const seats = seatOf(rec, userId);
    if (seats.length === 0) throw new ApiError(403, "NOT_PARTICIPANT", "You are not a player in this match");
    const st = rec.state;
    if (st.status === "WAITING") {
      if (rec.createdBy !== userId) throw new ApiError(403, "NOT_PARTICIPANT", "Only the host can close this table");
      closeNoResult(rec, "ended");
    } else if (st.status === "ACTIVE" && !online(rec)) {
      closeNoResult(rec, "ended");
    } else if (st.status === "ACTIVE") {
      rec.version += 1;
      pushEvents(rec, applyAction(st, seats[0], { actionType: "FORFEIT_MATCH", payload: { confirm: true } }, envFor(rec)));
    } else {
      return { matchId, status: st.status };
    }
    await save(t, rec);
    return { matchId, status: rec.state.status };
  });
}

/**
 * Administrative void (spec 02): the record stays, with who, why and when, and it leaves both
 * players' stats. Free matches hold no reserves, so there is nothing to reverse in the ledger.
 */
export async function voidMatchIn(t: Tx, matchId: string, by: string, reason: string) {
  const rec = await t.matches.get(matchId, { lock: true });
  if (!rec) throw notFound("Match");
  if (rec.state.status !== "ACTIVE" && rec.state.status !== "COMPLETED") {
    throw new ApiError(409, "WRONG_PHASE", "Only matches in progress or finished can be voided");
  }
  const from = rec.state.status;
  rec.state.status = "VOIDED";
  rec.voided = { by, reason, at: new Date().toISOString() };
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_VOIDED", payload: { reason } }]);
  await t.results.deleteForMatch(matchId);
  await save(t, rec);
  return { from, ledger: "none: free match, nothing reserved" };
}

/** Admin: close a waiting table. */
export async function cancelTableIn(t: Tx, matchId: string) {
  const rec = await t.matches.get(matchId, { lock: true });
  if (!rec) throw notFound("Match");
  if (rec.state.status !== "WAITING") throw new ApiError(409, "WRONG_PHASE", "Only waiting tables can be closed");
  rec.state.status = "CANCELLED";
  rec.version += 1;
  pushEvents(rec, [{ type: "MATCH_CANCELLED", payload: { reason: "admin" } }]);
  await save(t, rec);
}

export interface SpectatorSettings {
  allow?: unknown;
  chat?: unknown;
  emoji?: unknown;
}

/** The host decides who may watch and whether spectators may chat or send reactions. */
export function setSpectatorSettings(userId: string, matchId: string, body: SpectatorSettings) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId, { lock: true });
    if (!rec) throw notFound("Match");
    if (rec.createdBy !== userId || !rec.seats.includes(userId)) throw new ApiError(403, "NOT_PARTICIPANT", "Only the host can change this");
    if (!online(rec)) throw new ApiError(409, "WRONG_PHASE", "This match is not shown to others");
    if (typeof body.allow === "boolean") rec.allowSpectators = body.allow;
    if (typeof body.chat === "boolean") rec.spectatorChat = body.chat;
    if (typeof body.emoji === "boolean") rec.spectatorEmoji = body.emoji;
    rec.version += 1;
    const settings = spectatorSettingsOf(rec);
    pushEvents(rec, [{ type: "SPECTATORS_CHANGED", payload: { ...settings } }]);
    await save(t, rec);
    return settings;
  });
}

export const spectatorSettingsOf = (rec: MatchRecord) => ({
  allow: rec.allowSpectators !== false,
  chat: rec.spectatorChat !== false,
  emoji: rec.spectatorEmoji !== false,
});

/** What this viewer may do in the match chat: players can always talk; spectators as the host allows. */
export function chatRights(rec: MatchRecord, userId: string) {
  const open = online(rec) && (rec.state.status === "ACTIVE" || rec.state.status === "COMPLETED");
  if (!open) return { send: false, react: false };
  if (rec.seats.includes(userId)) return { send: true, react: true };
  if (rec.allowSpectators === false || rec.removedSpectators?.includes(userId)) return { send: false, react: false };
  return { send: rec.spectatorChat !== false, react: rec.spectatorEmoji !== false };
}

/** Host only: stop one spectator from watching and chatting in this match. */
export async function removeSpectatorIn(t: Tx, userId: string, matchId: string, spectatorId: string) {
  const rec = await t.matches.get(matchId, { lock: true });
  if (!rec) throw notFound("Match");
  if (rec.createdBy !== userId) throw new ApiError(403, "NOT_PARTICIPANT", "Only the host can remove spectators");
  if (rec.seats.includes(spectatorId)) throw new ApiError(409, "WRONG_PHASE", "Players cannot be removed");
  rec.removedSpectators = [...new Set([...(rec.removedSpectators ?? []), spectatorId])];
  rec.version += 1;
  pushEvents(rec, [{ type: "SPECTATOR_REMOVED", payload: {} }]);
  await save(t, rec);
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

    // Acting proves the player is here (keeps their clock in normal mode).
    for (const seat of seats) await t.presence.touch(matchId, seat, Date.now());
    const prior = await t.matches.action(matchId, actionId);
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
      events = applyAction(rec.state, actor, action, envFor(rec));
    } catch (e) {
      if (e instanceof GameError) throw new ApiError(422, e.code, e.message, { currentVersion: rec.version });
      throw e;
    }
    rec.version += 1;
    pushEvents(rec, events);
    const response = { version: rec.version };
    rec.actions[actionId] = { fingerprint, response };
    await save(t, rec);
    return response;
  });
}

/**
 * Presence ("online" badge) is stored in the database so it is correct across server instances.
 * Each process writes a seat's heartbeat at most every PRESENCE_WRITE_MS to keep polling cheap.
 */
const lastPresenceWrite = ((globalThis as unknown as { __bgPresenceW?: Map<string, number> }).__bgPresenceW ??= new Map());
const PRESENCE_WRITE_MS = 3000;
// Pages with instant updates poll only every ~10 s, so "online" allows for a missed poll or two.
const ONLINE_MS = 25000;

/**
 * Players may switch watching off once a match is under way. A WAITING table stays visible so an
 * invited player can still open the link and join.
 */
export function assertMayWatch(rec: MatchRecord, userId: string, spectatorsOn: boolean) {
  if (rec.seats.includes(userId) || rec.state.status === "WAITING" || rec.state.status === "CANCELLED") return;
  if (rec.removedSpectators?.includes(userId)) throw new ApiError(403, "NOT_PARTICIPANT", "The host removed you from this match");
  if (rec.allowSpectators === false) throw new ApiError(403, "NOT_PARTICIPANT", "The players turned off watching for this match");
  if (!spectatorsOn) throw new ApiError(403, "NOT_PARTICIPANT", "Watching other players' matches is paused right now");
}

/** Snapshot for a player or a spectator. Never includes user IDs, wallets or payment data. */
export async function getSnapshot(userId: string, matchId: string, settled = false, returnNoted = false): Promise<MatchSnapshot> {
  const now = Date.now();
  const { rec, users, seen, spectators, events, due, returned } = await tx(async (t) => {
    const m = await t.matches.get(matchId);
    if (!m) return { rec: undefined, users: {}, seen: [0, 0] as [number, number], spectators: 0, events: [], due: false, returned: null };
    assertMayWatch(m, userId, (await operatorSettings(t)).spectators);
    const mine = seatOf(m, userId);
    // Back after a drop on your turn? The time away comes off the reconnect allowance, not the bank.
    if (!returnNoted && m.clock && m.clock.seat !== null && mine.includes(m.clock.seat) && m.state.status === "ACTIVE") {
      const before = await t.presence.get(matchId);
      const free = !!m.startedAt && before[0] < m.startedAt;
      if (noteReturn({ ...m.clock, awayUsedMs: [...m.clock.awayUsedMs] }, m.clock.seat, before, now, free)) {
        return { rec: m, users: {}, seen: before, spectators: 0, events: [], due: false, returned: { seat: m.clock.seat, before } };
      }
    }
    for (const s of mine) {
      const key = `${matchId}:${s}`;
      if (now - (lastPresenceWrite.get(key) ?? 0) >= PRESENCE_WRITE_MS) {
        await t.presence.touch(matchId, s, now);
        lastPresenceWrite.set(key, now);
      }
    }
    if (mine.length === 0 && m.state.status === "ACTIVE") {
      const key = `${matchId}:w:${userId}`;
      if (now - (lastPresenceWrite.get(key) ?? 0) >= PRESENCE_WRITE_MS) {
        await t.spectators.touch(matchId, userId, now);
        lastPresenceWrite.set(key, now);
      }
    }
    const seen = await t.presence.get(matchId);
    // A match left alone is settled when someone looks at it (the timers also run in the sweep).
    if (!settled && settlementFor(m, seen, now)) return { rec: m, users: {}, seen, spectators: 0, events: [], due: true, returned: null };
    const ids = m.seats.filter((s) => s && s !== BOT_USER_ID) as string[];
    return {
      rec: m,
      users: await t.users.getMany(ids),
      seen,
      spectators: online(m) ? await t.spectators.count(matchId, now - SPECTATOR_WINDOW_MS) : 0,
      events: await t.matches.events(matchId, { last: 30 }),
      due: false,
      returned: null,
    };
  });
  if (!rec) throw notFound("Match");
  if (due) {
    await tx((t) => settleIn(t, matchId, now));
    return getSnapshot(userId, matchId, true, true);
  }
  if (returned) {
    await tx(async (t) => {
      const r = await t.matches.get(matchId, { lock: true });
      const free = !!r?.startedAt && returned.before[0] < r.startedAt;
      if (r?.clock && r.state.status === "ACTIVE" && noteReturn(r.clock, returned.seat, returned.before, now, free)) {
        await t.presence.touch(matchId, returned.seat, now);
        await t.matches.put(r);
      }
    });
    return getSnapshot(userId, matchId, settled, true);
  }
  return snapshotOf(rec, userId, users, seen, spectators, events, now);
}

function snapshotOf(
  rec: MatchRecord,
  userId: string,
  users: Record<string, User>,
  seen: [number, number],
  spectators: number,
  events: StoredEvent[],
  now: number,
) {
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
      level: rec.seats[s] && users[rec.seats[s]!] ? levelOf(users[rec.seats[s]!].xp ?? 0).level : null,
      frame: rec.seats[s] && users[rec.seats[s]!] ? (users[rec.seats[s]!].frame ?? "none") : "none",
      bot: rec.seats[s] === BOT_USER_ID,
      online: rec.mode === "local" || rec.seats[s] === BOT_USER_ID || mySeats.includes(s) ? true : now - seen[s] < ONLINE_MS,
    })),
    yourSeats: mySeats,
    role: mySeats.length ? ("player" as const) : ("spectator" as const),
    spectators,
    allowSpectators: rec.allowSpectators !== false,
    spectatorSettings: spectatorSettingsOf(rec),
    chat: chatRights(rec, userId),
    isHost: rec.createdBy === userId && mySeats.length > 0,
    closedReason: rec.closedReason ?? null,
    /** Set while the host has not come back since someone joined: the match is called off at this time. */
    /** Clocks as of `serverNow`; the browser counts down from there. */
    clock: rec.clock && st.status === "ACTIVE" ? { preset: rec.clock.preset, perMoveMs: rec.clock.perMoveMs, ...clockView(rec.clock, seen, now) } : null,
    clockPreset: rec.clock?.preset ?? "none",
    fair: fairView(rec.fair, st.status !== "WAITING" && st.status !== "ACTIVE"),
    hostReturnBy:
      online(rec) && st.status === "ACTIVE" && rec.startedAt && seen[0] < rec.startedAt ? new Date(rec.startedAt + HOST_RETURN_MS).toISOString() : null,
    voided: rec.voided ? { reason: rec.voided.reason, at: rec.voided.at } : null,
    canJoin: st.status === "WAITING" && rec.mode !== "local" && rec.mode !== "bot" && mySeats.length === 0,
    canCancel: st.status === "WAITING" && rec.createdBy === userId,
    seatToAct: seatToAct(st),
    game: g ? { ...g, cubeBlock: [cubeBlockReason(st, 0), cubeBlockReason(st, 1)] } : null,
    events,
    eventCursor: rec.eventSeq,
    serverNow: new Date(now).toISOString(),
  };
}

export type MatchSnapshot = ReturnType<typeof snapshotOf>;

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
    const events = applyAction(rec.state, seat, action, envFor(rec));
    rec.version += 1;
    pushEvents(rec, events);
    await save(t, rec);
  });
}

/** Committed events after `cursor` (spec: GET /matches/{id}/history). Participants only. */
export async function matchHistory(userId: string, matchId: string, cursor: number) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId);
    if (!rec) throw notFound("Match");
    assertMayWatch(rec, userId, true);
    // The whole log is kept, so a cursor is never too old for a replay.
    return { events: await t.matches.events(matchId, { after: Math.max(0, cursor) }), eventCursor: rec.eventSeq, snapshotRequired: false };
  });
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
