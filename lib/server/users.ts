import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { ApiError } from "./errors";
import { grantFreeCredits } from "./ledger";
import { tx, type Tx, type User } from "./store";

export const FREE_CREDIT_GRANT = 1000 * TOKEN_SCALE;
export const THEME_IDS = ["walnut", "slate", "forest", "midnight", "burgundy", "sand"];
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- Sessions ---------------------------------------------------------------------------------

/** A guest with no activity for this long is removed (with their computer and unjoined games). */
export const GUEST_IDLE_MS = 30 * 60 * 1000;

/**
 * A guest can play free games immediately; it becomes an account when a wallet signs in. Guests get
 * no practice credits (those come with the account), so removing an idle guest leaves no balances.
 */
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
  await t.users.touchSeen(id, Date.now());
  return user;
}

/** The welcome grant, once per account, when a wallet first signs in. */
export const grantWelcomeCredits = (t: Tx, userId: string) => grantFreeCredits(t, userId, FREE_CREDIT_GRANT);

// Last-activity writes are throttled per process; 30-minute idleness needs only minute precision.
const lastSeenWrite = ((globalThis as unknown as { __bgSeenW?: Map<string, number> }).__bgSeenW ??= new Map());

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
    if (existing) {
      const now = Date.now();
      if (now - (lastSeenWrite.get(existing.id) ?? 0) >= 60_000) {
        lastSeenWrite.set(existing.id, now);
        await t.users.touchSeen(existing.id, now);
      }
      return { user: existing, token: valid };
    }
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
  const name = value
    .trim()
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, 20);
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
    if (typeof prefs.bio === "string")
      user.bio = prefs.bio
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 160);
    if (typeof prefs.country === "string")
      user.country = prefs.country
        .replace(/[^\p{L} .'-]/gu, "")
        .trim()
        .slice(0, 40);
    await t.users.put(user);
    return profileIn(t, userId);
  });
}

export const avatarUrl = (user: Pick<User, "avatar"> | undefined) => (user?.avatar ? `/api/avatars/${user.avatar}` : null);

export const HISTORY_PAGE = 10;

/** One page of the player's finished matches, newest first. */
export async function matchHistoryPage(t: Tx, userId: string, offset: number) {
  const rows = await t.results.history(userId, Math.max(0, Math.trunc(offset) || 0), HISTORY_PAGE + 1);
  return {
    items: rows.slice(0, HISTORY_PAGE).map((r) => ({
      matchId: r.matchId,
      mode: r.mode,
      opponent: r.opponent,
      won: r.won,
      score: r.score,
      targetPoints: r.targetPoints,
      reason: r.endReason,
      date: r.completedAt,
    })),
    hasMore: rows.length > HISTORY_PAGE,
  };
}

/** Totals come from the per-match results table, so they stay correct for any number of matches. */
export async function playerStats(t: Tx, userId: string) {
  const s = await t.results.stats(userId);
  const page = await matchHistoryPage(t, userId, 0);
  return {
    played: s.played,
    wins: s.wins,
    losses: s.played - s.wins,
    winRate: s.played ? Math.round((s.wins / s.played) * 100) : 0,
    gammons: s.gammons,
    points: s.points,
    currentStreak: s.currentStreak,
    bestStreak: s.bestStreak,
    history: page.items,
    historyMore: page.hasMore,
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
