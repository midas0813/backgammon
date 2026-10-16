import { createHash } from "node:crypto";
import { BOT_USER_ID } from "./bot";
import { ApiError } from "./errors";
import { HOST_ONLINE_MS, createMatch, expireTable } from "./matches";
import { operatorSettings } from "./settings";
import { tx, type LobbyRow, type MatchRecord, type Tx, type User } from "./store";
import { avatarUrl } from "./users";

/**
 * The online lobby: open tables to join, live matches to watch, and the player's own tables.
 * Tables are public (mode "quick", listed) or private (mode "private", invite link only).
 */
export const TABLE_EXPIRY_MS = 15 * 60 * 1000;
export const MAX_OPEN_TABLES = 3;
const TABLES_PER_MINUTE = 5;
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const LIVE_STALE_MS = 30 * 60 * 1000;
const ALLOWED_POINTS = [1, 3, 5, 7];

// Activity writes are throttled per process so frequent polling stays cheap.
const lastWrite = ((globalThis as unknown as { __bgLobbyW?: Map<string, number> }).__bgLobbyW ??= new Map());
function due(key: string, now: number, every: number) {
  if (now - (lastWrite.get(key) ?? 0) < every) return false;
  lastWrite.set(key, now);
  return true;
}

/** "Players online" and daily activity. */
export async function touchUser(t: Tx, userId: string, now = Date.now()) {
  if (due(`seen:${userId}`, now, 20_000)) await t.users.touchSeen(userId, now);
}

const isOpenTable = (m: MatchRecord, userId: string) =>
  m.state.status === "WAITING" && m.createdBy === userId && (m.mode === "quick" || m.mode === "private");

export async function createTable(userId: string, body: { targetPoints?: unknown; visibility?: unknown; allowSpectators?: unknown }) {
  const targetPoints = Number(body.targetPoints);
  if (!ALLOWED_POINTS.includes(targetPoints)) throw new ApiError(400, "INVALID_INPUT", "Unsupported match length");
  const visibility = body.visibility === "private" ? "private" : "public";
  await tx(async (t) => {
    const mine = await t.matches.listForUser(userId);
    if (mine.filter((m) => isOpenTable(m, userId)).length >= MAX_OPEN_TABLES) {
      throw new ApiError(429, "RATE_LIMITED", `You already have ${MAX_OPEN_TABLES} open tables. Close one first.`);
    }
    const recent = mine.filter((m) => m.createdBy === userId && Date.now() - Date.parse(m.createdAt) < 60_000 && m.mode !== "bot" && m.mode !== "local");
    if (recent.length >= TABLES_PER_MINUTE) throw new ApiError(429, "RATE_LIMITED", "You are opening tables too quickly. Please wait a moment.");
  });
  return createMatch(userId, visibility === "private" ? "private" : "quick", targetPoints, {
    allowSpectators: body.allowSpectators !== false,
    joinExisting: false,
  });
}

/** One tap: join the oldest table with this length whose host is around, otherwise open one. */
export function findGame(userId: string, targetPoints: number) {
  if (!ALLOWED_POINTS.includes(targetPoints)) throw new ApiError(400, "INVALID_INPUT", "Unsupported match length");
  return createMatch(userId, "quick", targetPoints);
}

interface PlayerView {
  name: string;
  avatarUrl: string | null;
  bot: boolean;
}

function players(seats: [string | null, string | null], names: [string, string], users: Record<string, User>): [PlayerView, PlayerView] {
  const one = (i: 0 | 1): PlayerView => ({
    name: names[i],
    avatarUrl: seats[i] ? avatarUrl(users[seats[i]!]) : null,
    bot: seats[i] === BOT_USER_ID,
  });
  return [one(0), one(1)];
}

const realIds = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => !!id && id !== BOT_USER_ID))];

/** Close tables whose host has been gone for TABLE_EXPIRY_MS (oldest first). */
async function expireStaleTables(t: Tx, now: number) {
  const waiting = await t.matches.listLobby("WAITING", 100);
  const stale = waiting.filter((r) => (r.hostSeenAt || Date.parse(r.createdAt)) < now - TABLE_EXPIRY_MS).map((r) => r.id);
  for (const id of stale) await expireTable(t, id);
  return new Set(stale);
}

/** Counts shown on the lobby tiles: open tables to join and live matches to watch. */
async function publicCounts(t: Tx, now: number, spectators: boolean) {
  const base = { hostSeenSince: now - HOST_ONLINE_MS, activeSince: now - LIVE_STALE_MS, sort: "newest" as const, offset: 0, limit: 0 };
  const open = (await t.matches.listPublic({ ...base, status: "WAITING" })).total;
  const live = spectators ? (await t.matches.listPublic({ ...base, status: "ACTIVE" })).total : 0;
  return { open, live };
}

/** The player's own tables and matches plus lobby counts. Tables to join are paged by publicTables. */
export async function lobby(userId: string) {
  const data = await tx(async (t) => {
    const now = Date.now();
    await touchUser(t, userId, now);
    const stale = await expireStaleTables(t, now);

    const mineAll = await t.matches.listForUser(userId);
    // Being in the lobby counts as being around for your own tables.
    for (const m of mineAll.filter((m) => isOpenTable(m, userId))) {
      if (due(`host:${m.id}`, now, 10_000)) await t.presence.touch(m.id, 0, now);
    }
    const mine = mineAll
      .filter((m) => (m.state.status === "WAITING" || m.state.status === "ACTIVE") && !stale.has(m.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const users = await t.users.getMany(realIds(mine.flatMap((m) => m.seats)));
    const settings = await operatorSettings(t);
    const counts = await publicCounts(t, now, settings.spectators);
    const stats = await t.matches.stats();
    return {
      mine: mine.map((m) => ({
        matchId: m.id,
        mode: m.mode,
        status: m.state.status,
        targetPoints: m.state.targetPoints,
        players: players(m.seats, m.names, users),
        score: m.state.score,
        host: m.createdBy === userId,
        allowSpectators: m.allowSpectators !== false,
        createdAt: m.createdAt,
      })),
      counts: {
        online: await t.users.countSeenSince(now - ONLINE_WINDOW_MS),
        // Open tables other players can join (your own waiting tables are not counted).
        open: Math.max(0, counts.open - mine.filter((m) => m.state.status === "WAITING" && m.mode === "quick" && m.createdBy === userId).length),
        live: counts.live,
        playing: stats.live,
      },
      limits: { maxOpenTables: MAX_OPEN_TABLES, tableExpiryMinutes: TABLE_EXPIRY_MS / 60_000 },
      maintenance: settings.maintenance.enabled ? settings.maintenance.message : null,
    };
  });
  // Lets the client skip re-rendering when nothing changed (?v=).
  const version = createHash("sha1").update(JSON.stringify(data)).digest("base64url").slice(0, 16);
  return { ...data, version };
}

// ---- Room browser -------------------------------------------------------------------------------

export const PAGE_SIZE = 16;
/** Entry-fee filters in token minor units (100 = 1 token). */
export const FEE_BANDS: Record<string, [number | undefined, number | undefined]> = {
  all: [undefined, undefined],
  free: [0, 0],
  "1-10": [1, 1000],
  "10-50": [1001, 5000],
  "50+": [5001, undefined],
};

export interface PublicTableQuery {
  view?: unknown;
  points?: unknown;
  fee?: unknown;
  sort?: unknown;
  page?: unknown;
}

/**
 * One page of public tables, the same for every player (so it can be cached at the edge): tables
 * waiting for an opponent (view "open") or matches in progress to watch (view "live").
 */
export async function publicTables(input: PublicTableQuery) {
  const view = input.view === "live" ? "live" : "open";
  const points = ALLOWED_POINTS.includes(Number(input.points)) ? Number(input.points) : undefined;
  const fee = typeof input.fee === "string" && input.fee in FEE_BANDS ? input.fee : "all";
  const sort = input.sort === "oldest" ? "oldest" : "newest";
  const page = Math.max(0, Math.min(500, Math.trunc(Number(input.page) || 0)));
  const [feeMin, feeMax] = FEE_BANDS[fee];
  return tx(async (t) => {
    const now = Date.now();
    if (due("expire-sweep", now, 30_000)) await expireStaleTables(t, now);
    const settings = await operatorSettings(t);
    const { rows, total } =
      view === "live" && !settings.spectators
        ? { rows: [], total: 0 }
        : await t.matches.listPublic({
            status: view === "live" ? "ACTIVE" : "WAITING",
            points,
            feeMin,
            feeMax,
            hostSeenSince: now - HOST_ONLINE_MS,
            activeSince: now - LIVE_STALE_MS,
            sort,
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
          });
    const users = await t.users.getMany(realIds(rows.flatMap((r) => r.seats)));
    return {
      view,
      filters: { points: points ?? null, fee, sort },
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      serverNow: new Date(now).toISOString(),
      tables: rows.map((r) => {
        const [host, guest] = players(r.seats, r.names, users);
        return {
          matchId: r.id,
          targetPoints: r.targetPoints,
          entryFee: r.entryFee,
          createdAt: r.createdAt,
          host,
          hostOnline: r.hostSeenAt >= now - 15_000,
          // Live matches only:
          opponent: view === "live" ? guest : null,
          score: view === "live" ? r.score : null,
          cube: r.cube,
          gameNumber: r.gameNumber,
          spectators: r.spectators,
        };
      }),
    };
  });
}

export type PublicTables = Awaited<ReturnType<typeof publicTables>>;

export type Lobby = Awaited<ReturnType<typeof lobby>>;

/** Status of the caller's own tables, polled app-wide so a host hears "opponent joined" anywhere. */
export function tableStatus(userId: string, ids: string[]) {
  return tx(async (t) => {
    const out: { matchId: string; status: string; opponent: string | null }[] = [];
    for (const id of ids.slice(0, MAX_OPEN_TABLES + 2)) {
      const m = await t.matches.get(id);
      if (!m || m.createdBy !== userId) continue;
      if (m.state.status === "WAITING" && due(`host:${m.id}`, Date.now(), 10_000)) await t.presence.touch(m.id, 0, Date.now());
      out.push({ matchId: id, status: m.state.status, opponent: m.state.status === "WAITING" ? null : m.names[1] });
    }
    return { tables: out };
  });
}
