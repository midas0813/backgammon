import { GAMES } from "../games";
import { levelOf } from "../quests";
import { LIVE_WINDOW_MS, ONLINE_WINDOW_MS, touchUser } from "./lobby";
import { TABLE_EXPIRY_MS } from "./matches";
import { tx, type Tx } from "./store";

/** One line per game for the Play hub and Home: activity, and your level and rating in it. */
export async function gamesSummaryIn(t: Tx, userId: string, now = Date.now()) {
  const out = [];
  for (const g of GAMES) {
    const s = (await t.gameStats.getMany([userId], g.id))[userId];
    const open = await t.matches.listPublic({
      game: g.id,
      status: "WAITING",
      hostSeenSince: now - TABLE_EXPIRY_MS,
      activeSince: now - LIVE_WINDOW_MS,
      sort: "newest",
      offset: 0,
      limit: 0,
    });
    const xp = s?.xp ?? 0;
    out.push({
      ...g,
      xp,
      ...levelOf(xp),
      rating: Math.round(s?.rating ?? 1500),
      rated: (s?.ratingGames ?? 0) > 0,
      playing: await t.matches.countActiveSince(now - LIVE_WINDOW_MS, g.id),
      open: open.total,
    });
  }
  return out;
}

/** The Play hub: every game with its activity, plus players online on the platform. */
export function gamesHub(userId: string) {
  return tx(async (t) => {
    const now = Date.now();
    await touchUser(t, userId, now);
    return { games: await gamesSummaryIn(t, userId, now), online: await t.users.countSeenSince(now - ONLINE_WINDOW_MS) };
  });
}

export type GamesHub = Awaited<ReturnType<typeof gamesHub>>;
