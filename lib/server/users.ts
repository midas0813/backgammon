import { randomUUID } from "node:crypto";
import type { Seat } from "../engine/board";
import { TOKEN_SCALE } from "../fees";
import { ApiError } from "./errors";
import { grantFreeCredits } from "./ledger";
import { tx, type Tx, type User } from "./store";

export const FREE_CREDIT_GRANT = 1000 * TOKEN_SCALE;
export const THEME_IDS = ["walnut", "slate", "forest", "midnight", "burgundy", "sand"];
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- Sessions ---------------------------------------------------------------------------------

/** A guest can play free games immediately; it becomes an account when a wallet signs in. */
export async function createGuest(t: Tx): Promise<User> {
  const id = randomUUID();
  const user: User = {
    id,
    name: `Guest-${id.slice(0, 4).toUpperCase()}`,
    themeId: "walnut",
    reducedMotion: false,
    createdAt: new Date().toISOString(),
  };
  await t.users.put(user);
  await grantFreeCredits(t, id, FREE_CREDIT_GRANT);
  return user;
}

/**
 * Resolve the session token (an opaque httpOnly cookie issued by proxy.ts) to its user, creating a
 * guest for a new token. Returns the token actually in use.
 */
export async function resolveSession(token: string | undefined): Promise<{ user: User; token: string }> {
  return tx(async (t) => {
    const valid = token && TOKEN_RE.test(token) ? token : randomUUID();
    // Parallel first requests carry the same new cookie: only one may create its guest.
    await t.lock(`session:${valid}`);
    const session = await t.sessions.get(valid);
    const existing = session && (await t.users.get(session.userId));
    if (existing) return { user: existing, token: valid };
    const user = await createGuest(t);
    await t.sessions.put(valid, { userId: user.id, createdAt: new Date().toISOString() });
    return { user, token: valid };
  });
}

/** Tests/compat: the user behind a session token (a new guest when unknown). */
export async function ensureUser(token: string | undefined): Promise<User> {
  return (await resolveSession(token)).user;
}

export async function logOut(token: string | undefined) {
  if (!token) return;
  await tx((t) => t.sessions.delete(token));
}

/** Suspended accounts cannot sign in with their wallet or start/join matches. Expired suspensions lapse. */
export function isSuspended(user: Pick<User, "status" | "suspendedUntil">, now = Date.now()) {
  return user.status === "suspended" && (!user.suspendedUntil || Date.parse(user.suspendedUntil) > now);
}

export function assertActive(user: User | undefined) {
  if (user && isSuspended(user)) {
    const until = user.suspendedUntil ? ` until ${new Date(user.suspendedUntil).toUTCString()}` : "";
    throw new ApiError(403, "INELIGIBLE", `This account is suspended${until}. Contact support if you think this is a mistake.`);
  }
}

// ---- Profile ----------------------------------------------------------------------------------

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 20);
  return name.length >= 2 ? name : null;
}

export async function updatePreferences(
  userId: string,
  prefs: {
    name?: unknown;
    themeId?: unknown;
    reducedMotion?: unknown;
    bio?: unknown;
    country?: unknown;
    sound?: unknown;
    highContrast?: unknown;
    orientation?: unknown;
  },
) {
  return tx(async (t) => {
    const user = (await t.users.get(userId))!;
    const name = cleanName(prefs.name);
    if (name) user.name = name;
    if (typeof prefs.themeId === "string" && THEME_IDS.includes(prefs.themeId)) user.themeId = prefs.themeId;
    if (typeof prefs.reducedMotion === "boolean") user.reducedMotion = prefs.reducedMotion;
    if (typeof prefs.sound === "boolean") user.sound = prefs.sound;
    if (typeof prefs.highContrast === "boolean") user.highContrast = prefs.highContrast;
    if (prefs.orientation === "left" || prefs.orientation === "right") user.boardOrientation = prefs.orientation;
    if (typeof prefs.bio === "string") user.bio = prefs.bio.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
    if (typeof prefs.country === "string") user.country = prefs.country.replace(/[^\p{L} .'-]/gu, "").trim().slice(0, 40);
    await t.users.put(user);
    return profileIn(t, userId);
  });
}

export const avatarUrl = (user: Pick<User, "avatar"> | undefined) => (user?.avatar ? `/api/avatars/${user.avatar}` : null);

export async function playerStats(t: Tx, userId: string) {
  const finished = (await t.matches.listForUser(userId))
    .filter((m) => m.state.status === "COMPLETED" && m.mode !== "local")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let wins = 0,
    gammons = 0,
    points = 0,
    streak = 0,
    bestStreak = 0;
  const history = finished.map((m) => {
    const seat = m.seats.indexOf(userId) as Seat;
    const opp = (1 - seat) as Seat;
    const won = m.state.winner === seat;
    if (won) {
      wins++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else streak = 0;
    for (const r of m.state.results) {
      if (r.winner === seat) {
        points += r.points;
        if (r.kind === "gammon" || r.kind === "backgammon") gammons++;
      }
    }
    return {
      matchId: m.id,
      mode: m.mode,
      opponent: m.names[opp],
      won,
      score: [m.state.score[seat], m.state.score[opp]] as [number, number],
      targetPoints: m.state.targetPoints,
      reason: m.state.endReason,
      date: m.createdAt,
    };
  });
  return {
    played: finished.length,
    wins,
    losses: finished.length - wins,
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    gammons,
    points,
    currentStreak: streak,
    bestStreak,
    history: history.reverse().slice(0, 12),
  };
}

/** What the signed-in user (or guest) may see about themselves. */
export async function profileIn(t: Tx, userId: string) {
  const u = await t.users.get(userId);
  if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Session expired");
  return {
    name: u.name,
    walletAddress: u.walletAddress ?? null,
    chainId: u.chainId ?? null,
    registered: !!u.walletAddress,
    registeredAt: u.registeredAt ?? null,
    createdAt: u.createdAt,
    avatarUrl: avatarUrl(u),
    bio: u.bio ?? "",
    country: u.country ?? "",
    themeId: u.themeId,
    reducedMotion: u.reducedMotion,
    sound: u.sound ?? true,
    highContrast: u.highContrast ?? false,
    orientation: u.boardOrientation ?? "right",
    stats: await playerStats(t, userId),
  };
}

export const profileOf = (userId: string) => tx((t) => profileIn(t, userId));

export type Profile = Awaited<ReturnType<typeof profileIn>>;
