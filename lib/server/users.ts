import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { transact, type Db, type User } from "./db";
import { grantFreeCredits } from "./ledger";

export const FREE_CREDIT_GRANT = 1000 * TOKEN_SCALE;
export const THEME_IDS = ["walnut", "slate", "forest", "midnight", "burgundy", "sand"];

/** Guest identity for the MVP. A production build replaces this with an approved auth flow. */
export function ensureUser(id: string | undefined): User {
  return transact((db) => ensureUserIn(db, id));
}

export function ensureUserIn(db: Db, id: string | undefined): User {
  if (id && db.users[id]) return db.users[id];
  const newId = randomUUID();
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
