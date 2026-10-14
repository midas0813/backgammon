import { createHash } from "node:crypto";
import { BOT_USER_ID } from "./bot";
import { ApiError } from "./errors";
import { HOST_ONLINE_MS, createMatch, expireTable } from "./matches";
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

export async function lobby(userId: string, opts: { points?: number } = {}) {
  const data = await tx(async (t) => {
    const now = Date.now();
    await touchUser(t, userId, now);

    // Housekeeping: tables whose host has been gone for TABLE_EXPIRY_MS close themselves.
    const waiting = await t.matches.listLobby("WAITING", 100);
    const lastSign = (r: LobbyRow) => r.hostSeenAt || Date.parse(r.createdAt);
    const stale = new Set(waiting.filter((r) => lastSign(r) < now - TABLE_EXPIRY_MS).map((r) => r.id));
    for (const id of stale) await expireTable(t, id);

    const mineAll = await t.matches.listForUser(userId);
    // Being in the lobby counts as being around for your own tables.
    for (const m of mineAll.filter((m) => isOpenTable(m, userId))) {
      if (due(`host:${m.id}`, now, 10_000)) await t.presence.touch(m.id, 0, now);
    }
    const mineIds = new Set(mineAll.map((m) => m.id));

    const open = waiting.filter(
      (r) =>
        !stale.has(r.id) &&
        r.hostId !== userId &&
        r.hostSeenAt >= now - HOST_ONLINE_MS &&
        (!opts.points || r.targetPoints === opts.points),
    );
    const live = (await t.matches.listLobby("ACTIVE", 60)).filter(
      (r) => r.allowSpectators && r.updatedAt >= now - LIVE_STALE_MS && !mineIds.has(r.id),
    );
    const mine = mineAll
      .filter((m) => (m.state.status === "WAITING" || m.state.status === "ACTIVE") && !stale.has(m.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const users = await t.users.getMany(realIds([...open, ...live].flatMap((r) => r.seats).concat(mine.flatMap((m) => m.seats))));
    const stats = await t.matches.stats();
    return {
      open: open.map((r) => ({
        matchId: r.id,
        targetPoints: r.targetPoints,
        createdAt: r.createdAt,
        host: players(r.seats, r.names, users)[0],
        hostOnline: r.hostSeenAt >= now - 15_000,
      })),
      live: live.slice(0, 30).map((r) => ({
        matchId: r.id,
        targetPoints: r.targetPoints,
        players: players(r.seats, r.names, users),
        score: r.score,
        cube: r.cube,
        gameNumber: r.gameNumber,
        spectators: r.spectators,
      })),
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
        live: stats.live,
        open: open.length,
      },
      limits: { maxOpenTables: MAX_OPEN_TABLES, tableExpiryMinutes: TABLE_EXPIRY_MS / 60_000 },
    };
  });
  // Lets the client skip re-rendering when nothing changed (?v=).
  const version = createHash("sha1").update(JSON.stringify(data)).digest("base64url").slice(0, 16);
  return { ...data, version };
}

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
