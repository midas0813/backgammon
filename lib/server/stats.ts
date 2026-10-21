import { GAMES } from "../games";
import type { StatsKey, Tx } from "./store";

const KEYS: StatsKey[] = [...GAMES.map((g) => g.id), "arena"];

/**
 * Account ("Arena") XP: everything earned in every game plus platform quests. The Arena level and the
 * avatar frames it unlocks come from this; each game also has its own level.
 */
export async function accountXpMany(t: Tx, ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  for (const key of KEYS) {
    const stats = await t.gameStats.getMany(ids, key);
    for (const [id, s] of Object.entries(stats)) out[id] = (out[id] ?? 0) + s.xp;
  }
  return out;
}

export async function accountXp(t: Tx, id: string) {
  return (await accountXpMany(t, [id]))[id] ?? 0;
}
