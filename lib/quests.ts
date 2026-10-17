/**
 * Quests, XP, levels and cosmetics (Phase 2 "Daily and weekly quests"). Shared by the server (progress,
 * claims) and the browser (cards, levels, frames). Every number here is a starting value.
 */

/** What a quest counts. Filled in from finished matches and turns (lib/server/quests.ts). */
export type QuestMetric =
  | "matchesPlayed" // any finished match except pass & play
  | "onlinePlayed"
  | "onlineWins"
  | "wins"
  | "hits" // opponent checkers you hit
  | "bearOffWins" // games won by bearing off all 15
  | "gammonWins"
  | "longMatchWins" // won a match of 5 points or more
  | "computerPlayed";

export interface Quest {
  id: string;
  period: "daily" | "weekly";
  title: string;
  metric: QuestMetric;
  target: number;
  xp: number;
  /** Practice credits (minor units) for wallet accounts. */
  credits: number;
}

export const QUESTS: Quest[] = [
  { id: "d-play3", period: "daily", title: "Play 3 matches", metric: "matchesPlayed", target: 3, xp: 40, credits: 2000 },
  { id: "d-onlinewin", period: "daily", title: "Win an online match", metric: "onlineWins", target: 1, xp: 60, credits: 3000 },
  { id: "d-hit3", period: "daily", title: "Hit 3 of your opponent's checkers", metric: "hits", target: 3, xp: 40, credits: 2000 },
  { id: "d-bearoff", period: "daily", title: "Bear off all 15 checkers", metric: "bearOffWins", target: 1, xp: 40, credits: 2000 },
  { id: "d-computer", period: "daily", title: "Play a match against the computer", metric: "computerPlayed", target: 1, xp: 25, credits: 1000 },
  { id: "d-online2", period: "daily", title: "Play 2 online matches", metric: "onlinePlayed", target: 2, xp: 50, credits: 2500 },
  { id: "w-win5", period: "weekly", title: "Win 5 matches", metric: "wins", target: 5, xp: 150, credits: 10000 },
  { id: "w-online10", period: "weekly", title: "Play 10 online matches", metric: "onlinePlayed", target: 10, xp: 200, credits: 12000 },
  { id: "w-long", period: "weekly", title: "Win a 5-point match", metric: "longMatchWins", target: 1, xp: 150, credits: 8000 },
  { id: "w-gammon", period: "weekly", title: "Win a gammon", metric: "gammonWins", target: 1, xp: 120, credits: 6000 },
  { id: "w-hit20", period: "weekly", title: "Hit 20 checkers", metric: "hits", target: 20, xp: 120, credits: 6000 },
];

export const QUESTS_PER_PERIOD = 3;

const DAY = 86_400_000;
/** UTC day key, and the Monday (UTC) that starts the week. */
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export function weekKey(now: number) {
  const d = new Date(now);
  const monday = now - ((d.getUTCDay() + 6) % 7) * DAY - (now % DAY);
  return new Date(monday).toISOString().slice(0, 10);
}
export const periodKey = (period: Quest["period"], now: number) => (period === "daily" ? `d:${dayKey(now)}` : `w:${weekKey(now)}`);
/** When the current period ends (ms). */
export const periodEnds = (period: Quest["period"], now: number) =>
  period === "daily" ? now - (now % DAY) + DAY : Date.parse(`${weekKey(now)}T00:00:00Z`) + 7 * DAY;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** This period's quests: the same for everyone, rotated by date. */
export function activeQuests(period: Quest["period"], now: number): Quest[] {
  const key = periodKey(period, now);
  return QUESTS.filter((q) => q.period === period)
    .map((q) => ({ q, r: hash(`${key}:${q.id}`) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, QUESTS_PER_PERIOD)
    .map((x) => x.q);
}

/** XP needed to reach `level` (level 1 at 0 XP; each level needs 100 more than the last). */
export const xpForLevel = (level: number) => 50 * (level - 1) * level;
export function levelOf(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, into: xp - xpForLevel(level), span: xpForLevel(level + 1) - xpForLevel(level) };
}

/** Avatar frames, unlocked by level. */
export const FRAMES = [
  { id: "none", name: "No frame", level: 1 },
  { id: "mint", name: "Mint", level: 2 },
  { id: "gold", name: "Gold", level: 4 },
  { id: "ember", name: "Ember", level: 6 },
  { id: "aurora", name: "Aurora", level: 8 },
  { id: "crown", name: "Champion", level: 12 },
] as const;
export const frameUnlocked = (frame: string, level: number) => FRAMES.some((f) => f.id === frame && f.level <= level);

/** XP for finishing a match, before any quests: playing counts, winning counts more. */
export const MATCH_XP = { played: 10, won: 15 };
