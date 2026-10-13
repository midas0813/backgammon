import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { read, transact, type Db, type User } from "./db";
import { grantFreeCredits } from "./ledger";

export const FREE_CREDIT_GRANT = 1000 * TOKEN_SCALE;
export const THEME_IDS = ["walnut", "slate", "forest", "midnight", "burgundy", "sand"];

/** Guest identity for the MVP. A production build replaces this with an approved auth flow. */
export function ensureUser(id: string | undefined): User {
  const existing = id ? read((db) => db.users[id]) : undefined;
  return existing ?? transact((db) => ensureUserIn(db, id));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function ensureUserIn(db: Db, id: string | undefined): User {
  if (id && db.users[id]) return db.users[id];
  // Adopt the cookie ID issued by proxy.ts so concurrent first requests resolve to one user.
  const newId = id && UUID_RE.test(id) ? id : randomUUID();
  const user: User = {
    id: newId,
    name: `Guest-${newId.slice(0, 4).toUpperCase()}`,
    themeId: "walnut",
    reducedMotion: false,
    createdAt: new Date().toISOString(),
  };
  db.users[newId] = user;
  grantFreeCredits(db.ledger, newId, FREE_CREDIT_GRANT);
  return user;
}

export function updatePreferences(userId: string, prefs: { name?: unknown; themeId?: unknown; reducedMotion?: unknown }) {
  return transact((db) => {
    const user = db.users[userId];
    if (typeof prefs.name === "string") {
      const name = prefs.name.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 20);
      if (name.length >= 2) user.name = name;
    }
    if (typeof prefs.themeId === "string" && THEME_IDS.includes(prefs.themeId)) user.themeId = prefs.themeId;
    if (typeof prefs.reducedMotion === "boolean") user.reducedMotion = prefs.reducedMotion;
    return user;
  });
}
