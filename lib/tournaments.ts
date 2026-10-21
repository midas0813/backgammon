import { GAMES, isGameType, type GameType } from "./games";
import { TIME_CONTROLS } from "./chess/rules";

/**
 * Tournament series, set up by admins (players cannot organise tournaments):
 *  - sitgo: a table that starts the moment it is full, reopened after each start;
 *  - weekly / monthly: a cup on a fixed day and time (UTC), registration opens some hours before;
 *  - event: a one-off on a date.
 * Every series carries its rewards per finishing place. Each kind has default rewards that the admin
 * can keep or change. Shared by the server and the admin screens.
 */
export type TournamentKind = "sitgo" | "weekly" | "monthly" | "event";
export const KIND_LABEL: Record<TournamentKind, string> = { sitgo: "Sit & go", weekly: "Weekly", monthly: "Monthly", event: "Event" };

/** Rewards for one finishing place: XP in the game, practice credits, and an optional prize described in words. */
export interface TournamentReward {
  xp: number;
  credits: number;
  prize: string;
}
/** rewards[i] is for PLACES[i]. */
export const PLACES = ["Champion", "Runner-up", "Semi-finalists", "Quarter-finalists"] as const;

export const DEFAULT_REWARDS: Record<TournamentKind, TournamentReward[]> = {
  sitgo: [
    { xp: 200, credits: 0, prize: "" },
    { xp: 100, credits: 0, prize: "" },
    { xp: 0, credits: 0, prize: "" },
    { xp: 0, credits: 0, prize: "" },
  ],
  weekly: [
    { xp: 600, credits: 500, prize: "" },
    { xp: 300, credits: 250, prize: "" },
    { xp: 150, credits: 100, prize: "" },
    { xp: 50, credits: 0, prize: "" },
  ],
  monthly: [
    { xp: 1500, credits: 2000, prize: "" },
    { xp: 750, credits: 1000, prize: "" },
    { xp: 400, credits: 400, prize: "" },
    { xp: 150, credits: 100, prize: "" },
  ],
  event: [
    { xp: 1000, credits: 1000, prize: "" },
    { xp: 500, credits: 500, prize: "" },
    { xp: 250, credits: 200, prize: "" },
    { xp: 100, credits: 0, prize: "" },
  ],
};

export interface TournamentSeries {
  id: string;
  name: string;
  game: GameType;
  kind: TournamentKind;
  enabled: boolean;
  /** Sit & go: the exact table size. Scheduled: the most players (the bracket fits who registered). */
  size: number;
  /** Scheduled: fewer registered players than this at the start cancels the tournament. */
  minPlayers: number;
  /** Weekly: 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Monthly: day of the month, 1–28. */
  monthDay: number;
  /** Event: the day, YYYY-MM-DD. */
  date: string;
  /** Start time, HH:MM in UTC. */
  time: string;
  /** Registration opens this many hours before the start. */
  registrationHours: number;
  /** Backgammon: match length and clock. */
  points: number;
  clock: "standard" | "fast" | "none";
  /** Chess: time control. */
  timeControl: string;
  description: string;
  rewards: TournamentReward[];
}

export const SITGO_SIZES = [4, 8];
export const MAX_SIZES = [4, 8, 16, 32, 64];
export const POINT_CHOICES = [1, 3, 5, 7];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const base = {
  enabled: true,
  weekday: 6,
  monthDay: 1,
  date: "",
  time: "18:00",
  description: "",
  minPlayers: 4,
  clock: "standard" as const,
  points: 3,
  timeControl: "3+2",
};

/** Used until an admin saves their own list (the old sit & go tables keep their keys). */
export const DEFAULT_SERIES: TournamentSeries[] = [
  {
    ...base,
    id: "quick4",
    name: "Quick 4",
    game: "backgammon",
    kind: "sitgo",
    size: 4,
    points: 1,
    clock: "fast",
    registrationHours: 0,
    rewards: DEFAULT_REWARDS.sitgo,
  },
  { ...base, id: "classic8", name: "Classic 8", game: "backgammon", kind: "sitgo", size: 8, registrationHours: 0, rewards: DEFAULT_REWARDS.sitgo },
  { ...base, id: "blitz4", name: "Blitz 4", game: "chess", kind: "sitgo", size: 4, registrationHours: 0, rewards: DEFAULT_REWARDS.sitgo },
  {
    ...base,
    id: "bg-weekly",
    name: "Weekly Backgammon Cup",
    game: "backgammon",
    kind: "weekly",
    size: 32,
    weekday: 6,
    registrationHours: 72,
    description: "Every Saturday. 3-point matches, standard clock.",
    rewards: DEFAULT_REWARDS.weekly,
  },
  {
    ...base,
    id: "chess-weekly",
    name: "Weekly Chess Blitz",
    game: "chess",
    kind: "weekly",
    size: 32,
    weekday: 0,
    registrationHours: 72,
    description: "Every Sunday. 3+2 blitz.",
    rewards: DEFAULT_REWARDS.weekly,
  },
  {
    ...base,
    id: "bg-monthly",
    name: "Monthly Backgammon Championship",
    game: "backgammon",
    kind: "monthly",
    size: 64,
    monthDay: 1,
    points: 5,
    registrationHours: 168,
    minPlayers: 8,
    description: "The first of every month. 5-point matches.",
    rewards: DEFAULT_REWARDS.monthly,
  },
  {
    ...base,
    id: "chess-monthly",
    name: "Monthly Chess Championship",
    game: "chess",
    kind: "monthly",
    size: 64,
    monthDay: 2,
    timeControl: "10+0",
    registrationHours: 168,
    minPlayers: 8,
    description: "The second of every month. 10-minute rapid.",
    rewards: DEFAULT_REWARDS.monthly,
  },
];

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const text = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** A clean series from admin input; throws a message on what can't be fixed. */
export function cleanSeries(raw: Record<string, unknown>, fallbackId: string): TournamentSeries {
  const kind: TournamentKind = (["sitgo", "weekly", "monthly", "event"] as const).find((k) => k === raw.kind) ?? "weekly";
  const game: GameType = isGameType(raw.game) ? raw.game : "backgammon";
  const name = text(raw.name, 48);
  if (name.length < 3) throw new Error("Give the tournament a name (at least 3 characters)");
  const time = typeof raw.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : "18:00";
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "";
  if (kind === "event" && !date) throw new Error("Pick the event's date");
  const sizes = kind === "sitgo" ? SITGO_SIZES : MAX_SIZES;
  const size = sizes.includes(Number(raw.size)) ? Number(raw.size) : sizes[1];
  const defaults = DEFAULT_REWARDS[kind];
  const rawRewards = Array.isArray(raw.rewards) ? raw.rewards : [];
  const rewards = PLACES.map((_, i) => {
    const r = (rawRewards[i] ?? defaults[i]) as Partial<TournamentReward>;
    return { xp: int(r.xp, 0, 100_000, 0), credits: int(r.credits, 0, 1_000_000, 0), prize: text(r.prize, 60) };
  });
  const id = typeof raw.id === "string" && /^[a-z0-9-]{3,40}$/.test(raw.id) ? raw.id : fallbackId;
  return {
    id,
    name,
    game,
    kind,
    enabled: raw.enabled !== false,
    size,
    minPlayers: kind === "sitgo" ? size : int(raw.minPlayers, 2, size, Math.min(4, size)),
    weekday: int(raw.weekday, 0, 6, 6),
    monthDay: int(raw.monthDay, 1, 28, 1),
    date,
    time,
    registrationHours: kind === "sitgo" ? 0 : int(raw.registrationHours, 1, 24 * 30, kind === "monthly" ? 168 : 72),
    points: POINT_CHOICES.includes(Number(raw.points)) ? Number(raw.points) : 3,
    clock: raw.clock === "fast" || raw.clock === "none" ? raw.clock : "standard",
    timeControl: TIME_CONTROLS.some((t) => t.id === raw.timeControl) ? (raw.timeControl as string) : "3+2",
    description: text(raw.description, 200),
    rewards,
  };
}

/** The series list as stored (an admin's list, or the defaults until one is saved). */
export function seriesFromSetting(raw: unknown): TournamentSeries[] {
  if (!Array.isArray(raw)) return DEFAULT_SERIES;
  const out: TournamentSeries[] = [];
  for (const [i, r] of raw.entries()) {
    try {
      out.push(cleanSeries((r ?? {}) as Record<string, unknown>, `series-${i}`));
    } catch {
      // A broken entry is skipped rather than taking the list down.
    }
  }
  return out;
}

const at = (y: number, m: number, d: number, time: string) => {
  const [h, min] = time.split(":").map(Number);
  return Date.UTC(y, m, d, h, min);
};

/** The next start of a scheduled series at or after `from` (null for sit & go, or an event that has passed). */
export function nextStart(s: TournamentSeries, from: number): number | null {
  const now = new Date(from);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (s.kind === "sitgo") return null;
  if (s.kind === "event") {
    const [yy, mm, dd] = s.date.split("-").map(Number);
    const t = at(yy, mm - 1, dd, s.time);
    return t >= from ? t : null;
  }
  if (s.kind === "weekly") {
    const d = now.getUTCDate() + ((s.weekday - now.getUTCDay() + 7) % 7);
    const t = at(y, m, d, s.time);
    return t >= from ? t : at(y, m, d + 7, s.time);
  }
  const t = at(y, m, s.monthDay, s.time);
  return t >= from ? t : at(y, m + 1, s.monthDay, s.time);
}

/** "Every Saturday · 18:00 UTC" and the like. */
export function scheduleLabel(s: Pick<TournamentSeries, "kind" | "weekday" | "monthDay" | "date" | "time">) {
  if (s.kind === "sitgo") return "Starts when full";
  if (s.kind === "weekly") return `Every ${WEEKDAYS[s.weekday]} · ${s.time} UTC`;
  if (s.kind === "monthly") return `Monthly on the ${ordinal(s.monthDay)} · ${s.time} UTC`;
  return `${s.date} · ${s.time} UTC`;
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** What a match in this series is: "3-point · standard clock" or "3+2 blitz". */
export function formatLabel(s: { game?: GameType; points: number; clock: string; timeControl?: string | null }) {
  if (s.game === "chess") {
    const tc = TIME_CONTROLS.find((t) => t.id === s.timeControl);
    return tc ? `${tc.label} ${tc.kind.toLowerCase()}` : "no clock";
  }
  return `${s.points}-point · ${s.clock === "fast" ? "fast clock" : s.clock === "none" ? "no clock" : "standard clock"}`;
}

export const gameName = (g: GameType | undefined) => GAMES.find((x) => x.id === (g ?? "backgammon"))?.name ?? "Backgammon";
