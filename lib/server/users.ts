import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import type { Seat } from "../engine/board";
import { read, transact, type Db, type User } from "./db";
import { ApiError } from "./errors";
import { grantFreeCredits } from "./ledger";

export const FREE_CREDIT_GRANT = 1000 * TOKEN_SCALE;
export const THEME_IDS = ["walnut", "slate", "forest", "midnight", "burgundy", "sand"];
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- Sessions ---------------------------------------------------------------------------------

function createGuest(db: Db): User {
  const id = randomUUID();
  const user: User = {
    id,
    name: `Guest-${id.slice(0, 4).toUpperCase()}`,
    themeId: "walnut",
    reducedMotion: false,
    createdAt: new Date().toISOString(),
  };
  db.users[id] = user;
  grantFreeCredits(db.ledger, id, FREE_CREDIT_GRANT);
  return user;
}

/**
 * Resolve the session token (issued as an httpOnly cookie by proxy.ts) to a user, creating a guest
 * for a new token. Returns the token actually in use.
 */
export function resolveSession(token: string | undefined): { user: User; token: string } {
  const hit = token ? read((db) => (db.sessions[token] ? db.users[db.sessions[token].userId] : undefined)) : undefined;
  if (hit && token) return { user: hit, token };
  return transact((db) => {
    const t = token && TOKEN_RE.test(token) ? token : randomUUID();
    const existing = db.sessions[t];
    if (existing && db.users[existing.userId]) return { user: db.users[existing.userId], token: t };
    const user = createGuest(db);
    db.sessions[t] = { userId: user.id, createdAt: new Date().toISOString() };
    return { user, token: t };
  });
}

/** Test/compat helper: the user behind a session token (a new guest when unknown). */
export function ensureUser(token: string | undefined): User {
  return resolveSession(token).user;
}

// ---- Passwords --------------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(actual, expected);
}

// A fixed hash so unknown emails take the same time as wrong passwords.
const DUMMY_HASH = hashPassword("not-a-real-password");

// ---- Validation -------------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 20);
  return name.length >= 2 ? name : null;
}

function cleanEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, "INVALID_INPUT", "Enter a valid email address");
  return email;
}

function checkPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new ApiError(400, "INVALID_INPUT", "Password must be 8–128 characters");
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new ApiError(400, "INVALID_INPUT", "Password needs at least one letter and one number");
  }
  return value;
}

const emailTaken = (db: Db, email: string) => Object.values(db.users).some((u) => u.email === email);

// ---- Sign up / sign in / sign out -------------------------------------------------------------

/**
 * Register. A guest is upgraded in place, so its matches, practice credits and wallet history stay.
 * A session that already belongs to a registered account gets a brand-new account and session.
 */
export function signUp(token: string, body: { email?: unknown; password?: unknown; name?: unknown; acceptTerms?: unknown }) {
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const name = cleanName(body.name);
  if (!name) throw new ApiError(400, "INVALID_INPUT", "Display name must be 2–20 letters or numbers");
  if (body.acceptTerms !== true) throw new ApiError(400, "INVALID_INPUT", "Please accept the terms to continue");
  const passwordHash = hashPassword(password);

  return transact((db) => {
    if (emailTaken(db, email)) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
    const session = db.sessions[token];
    let user = session ? db.users[session.userId] : undefined;
    let newToken = token;
    if (!user || user.email) {
      user = createGuest(db);
      newToken = randomUUID();
      delete db.sessions[token];
      db.sessions[newToken] = { userId: user.id, createdAt: new Date().toISOString() };
    }
    user.email = email;
    user.passwordHash = passwordHash;
    user.name = name;
    user.registeredAt = new Date().toISOString();
    return { user, token: newToken };
  });
}

const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function logIn(oldToken: string | undefined, body: { email?: unknown; password?: unknown }, clientKey: string) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const key = `${email}|${clientKey}`;
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }
  const user = read((db) => Object.values(db.users).find((u) => u.email === email));
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;
  if (!ok) {
    attempts.set(key, [...recent, now]);
    throw new ApiError(401, "UNAUTHENTICATED", "Email or password is incorrect");
  }
  attempts.delete(key);
  return transact((db) => {
    if (oldToken) delete db.sessions[oldToken];
    const token = randomUUID();
    db.sessions[token] = { userId: user!.id, createdAt: new Date().toISOString() };
    return { user: db.users[user!.id], token };
  });
}

export function logOut(token: string | undefined) {
  if (!token) return;
  transact((db) => {
    delete db.sessions[token];
  });
}

// ---- Profile ----------------------------------------------------------------------------------

export function updatePreferences(
  userId: string,
  prefs: { name?: unknown; themeId?: unknown; reducedMotion?: unknown; bio?: unknown; country?: unknown },
) {
  return transact((db) => {
    const user = db.users[userId];
    const name = cleanName(prefs.name);
    if (name) user.name = name;
    if (typeof prefs.themeId === "string" && THEME_IDS.includes(prefs.themeId)) user.themeId = prefs.themeId;
    if (typeof prefs.reducedMotion === "boolean") user.reducedMotion = prefs.reducedMotion;
    if (typeof prefs.bio === "string") user.bio = prefs.bio.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
    if (typeof prefs.country === "string") user.country = prefs.country.replace(/[^\p{L} .'-]/gu, "").trim().slice(0, 40);
    return user;
  });
}

export const avatarUrl = (user: Pick<User, "avatar"> | undefined) => (user?.avatar ? `/api/avatars/${user.avatar}` : null);

export function playerStats(db: Db, userId: string) {
  const finished = Object.values(db.matches)
    .filter((m) => m.state.status === "COMPLETED" && m.mode !== "local" && m.seats.includes(userId))
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

/** What the signed-in user may see about themselves. Never includes the password hash. */
export function profileOf(userId: string) {
  return read((db) => {
    const u = db.users[userId];
    return {
      name: u.name,
      email: u.email ?? null,
      registered: !!u.email,
      registeredAt: u.registeredAt ?? null,
      createdAt: u.createdAt,
      avatarUrl: avatarUrl(u),
      bio: u.bio ?? "",
      country: u.country ?? "",
      themeId: u.themeId,
      reducedMotion: u.reducedMotion,
      wallets: u.wallets ?? [],
      stats: playerStats(db, userId),
    };
  });
}

export type Profile = ReturnType<typeof profileOf>;
