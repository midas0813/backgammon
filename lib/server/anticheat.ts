import { createHash } from "node:crypto";
import type { MatchRecord, Tx } from "./store";

/**
 * Anti-cheat (Phase 2): spot suspicious patterns and bring them to an admin, who reviews the replays
 * and decides. Nothing is punished automatically. While a flag is open, the matches it names do not
 * count toward prizes. Thresholds are starting values.
 */
export const THRESHOLDS = {
  /** Online matches between the same two players in one day. */
  samePairPerDay: 6,
  /** Losses to the same opponent by forfeit, timeout or abandonment within a week. */
  thrownLosses: 3,
  /** A new account (younger than this) winning nearly everything. */
  newAccountDays: 7,
  newAccountWins: 8,
  newAccountWinRate: 0.9,
  /** Decision times with almost no variation (coefficient of variation below this) over enough turns. */
  evenTimingTurns: 15,
  evenTimingCv: 0.12,
  /** Accounts created from one network in a day. */
  guestsPerNetworkPerDay: 10,
};

const DAY = 86_400_000;

/** A network address as stored: a salted hash, never the address itself. */
export function hashIp(ip: string) {
  const salt = process.env.IP_HASH_SALT || process.env.CRON_SECRET || "backgammon";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const pairKey = (a: string, b: string) => [a, b].sort().join("+");

async function flag(t: Tx, kind: string, key: string, userIds: string[], matchIds: string[], details: Record<string, unknown>) {
  const id = await t.flags.add({ kind, dedupeKey: `${kind}:${key}`, userIds, matchIds, details });
  // Under review: these results stop counting toward prizes until an admin clears them.
  if (id !== null) for (const m of matchIds) await t.results.setFlagged(m, true);
  return id;
}

/** Decision times (ms) per seat: from the roll to the confirmed move, for turns with a real choice. */
export function decisionTimes(events: { type: string; serverTime: string; payload: Record<string, unknown> }[]) {
  const out: [number[], number[]] = [[], []];
  const rolledAt: [number, number] = [0, 0];
  for (const e of events) {
    const seat = Number(e.payload.seat);
    if (e.type === "DICE_ROLLED" && (seat === 0 || seat === 1)) rolledAt[seat] = Date.parse(e.serverTime);
    if (e.type === "TURN_COMMITTED" && !e.payload.forced && (seat === 0 || seat === 1) && rolledAt[seat]) {
      out[seat].push(Date.parse(e.serverTime) - rolledAt[seat]);
      rolledAt[seat] = 0;
    }
  }
  return out;
}

export function coefficientOfVariation(xs: number[]) {
  if (xs.length < 2) return Infinity;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd / mean;
}

/** Checks for a finished online match between two people (called after its results are stored). */
export async function scanFinishedMatch(t: Tx, rec: MatchRecord, now = Date.now()) {
  if ((rec.mode !== "quick" && rec.mode !== "private") || rec.state.status !== "COMPLETED") return;
  const [a, b] = rec.seats;
  if (!a || !b || a === "bot" || b === "bot" || a === b) return;
  const users = await t.users.getMany([a, b]);
  const today = now - (now % DAY);

  // 1. The same two players, many times a day (passing points or prizes).
  const pairToday = await t.results.countAgainst(a, b, today, { played: true });
  if (pairToday >= THRESHOLDS.samePairPerDay) {
    await flag(t, "same-pair", `${pairKey(a, b)}:${day(now)}`, [a, b], [rec.id], { matchesToday: pairToday });
  }

  // 2. Losing on purpose: repeated forfeits, timeouts or abandonments to the same opponent.
  const winner = rec.state.winner;
  if (winner === 0 || winner === 1) {
    const loser = rec.seats[1 - winner]!;
    const won = rec.seats[winner]!;
    const thrown = await t.results.countLostBy(loser, won, now - 7 * DAY, ["forfeit", "timeout", "abandoned"]);
    if (thrown >= THRESHOLDS.thrownLosses) {
      await flag(t, "thrown-losses", `${loser}>${won}:${day(now)}`, [loser, won], [rec.id], { lossesThisWeek: thrown });
    }
  }

  // 3. Both players on the same network (one person on two accounts?).
  if (users[a]?.lastIp && users[a].lastIp === users[b]?.lastIp) {
    await flag(t, "same-network", `${pairKey(a, b)}:${day(now)}`, [a, b], [rec.id], {});
  }

  // 4. A brand-new account winning almost every game.
  for (const id of [a, b]) {
    const u = users[id];
    if (!u || now - Date.parse(u.createdAt) > THRESHOLDS.newAccountDays * DAY) continue;
    const s = await t.results.stats(id);
    if (s.wins >= THRESHOLDS.newAccountWins && s.wins / s.played >= THRESHOLDS.newAccountWinRate) {
      await flag(t, "new-account-streak", `${id}:${day(now)}`, [id], [rec.id], {
        wins: s.wins,
        played: s.played,
        accountAgeDays: Math.floor((now - Date.parse(u.createdAt)) / DAY),
      });
    }
  }

  // 5. Moves always made at the same speed, even in hard positions (possible help from a program).
  const times = decisionTimes(await t.matches.events(rec.id, {}));
  for (const seat of [0, 1] as const) {
    const xs = times[seat];
    const cv = coefficientOfVariation(xs);
    if (xs.length >= THRESHOLDS.evenTimingTurns && cv < THRESHOLDS.evenTimingCv) {
      const id = rec.seats[seat]!;
      await flag(t, "even-timing", `${id}:${rec.id}`, [id], [rec.id], {
        turns: xs.length,
        meanSeconds: Math.round(xs.reduce((x, y) => x + y, 0) / xs.length / 100) / 10,
        variation: Math.round(cv * 100) / 100,
      });
    }
  }
}

/** 6. Many accounts created from one network in a day (farming rewards). Called when a guest is created. */
export async function scanNewAccount(t: Tx, userId: string, ipHash: string | undefined, now = Date.now()) {
  if (!ipHash) return;
  const n = await t.users.countCreatedFrom(ipHash, now - DAY);
  if (n >= THRESHOLDS.guestsPerNetworkPerDay) {
    await flag(t, "account-farm", `${ipHash}:${day(now)}`, [userId], [], { accountsToday: n, network: ipHash.slice(0, 8) });
  }
}

export const FLAG_LABELS: Record<string, string> = {
  "same-pair": "Same two players matched many times today",
  "thrown-losses": "Repeated forfeits or timeouts to the same opponent",
  "same-network": "Opponents on the same network",
  "new-account-streak": "New account winning almost every game",
  "even-timing": "Moves made at the same speed every time",
  "account-farm": "Many accounts created from one network",
};
