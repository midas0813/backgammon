import type { Seat } from "../engine/board";
import { userBalances } from "./ledger";
import { sweep } from "./matches";
import { pulse, touchUser } from "./lobby";
import { operatorSettings } from "./settings";
import { tx } from "./store";
import { profileIn } from "./users";

export const DAILY_GOAL = 3;

/**
 * Start of the player's day in UTC ms. `tzOffset` is the browser's Date#getTimezoneOffset()
 * (minutes, UTC minus local), clamped to real-world offsets.
 */
export function startOfLocalDay(now: number, tzOffset: number) {
  const off = Number.isFinite(tzOffset) ? Math.max(-840, Math.min(720, Math.trunc(tzOffset))) : 0;
  const local = now - off * 60_000;
  return local - (local % 86_400_000) + off * 60_000;
}

/** Everything the Home tab shows, in one round trip. */
export async function homeData(userId: string, tzOffset: number) {
  await sweep();
  return tx(async (t) => {
    const now = Date.now();
    await touchUser(t, userId, now);
    const profile = await profileIn(t, userId);
    const balances = await userBalances(t, userId);
    const pendingDeposits = (await t.deposits.listByUser(userId))
      .filter((d) => d.status === "PENDING" || d.status === "CONFIRMED")
      .reduce((s, d) => s + d.tokenUnits, 0);

    const dayStart = startOfLocalDay(now, tzOffset);
    const today = await t.results.stats(userId, dayStart);
    const continuing = (await t.matches.listOpen(userId, 5)).map((m) => {
      const seat = Math.max(0, m.seats.indexOf(userId)) as Seat;
      const opp = (1 - seat) as Seat;
      return {
        matchId: m.id,
        mode: m.mode,
        status: m.status,
        targetPoints: m.targetPoints,
        opponent: m.mode === "local" ? "Pass & play" : m.status === "WAITING" ? null : m.names[opp],
        score: [m.score[seat], m.score[opp]] as [number, number],
        yourTurn: m.status === "ACTIVE" && m.mode !== "local" && m.seatToAct === seat,
      };
    });
    const settings = await operatorSettings(t);
    const counts = await pulse(t, now, settings.spectators);
    const myWaiting = continuing.filter((m) => m.mode === "quick" && m.status === "WAITING").length;
    const reports = await t.disputes.listByUser(userId);
    return {
      profile,
      balances: { ...balances, pendingDeposits },
      today: {
        matches: today.played,
        wins: today.wins,
        losses: today.played - today.wins,
        games: today.games,
        points: today.points,
        goal: DAILY_GOAL,
        dayStart: new Date(dayStart).toISOString(),
      },
      continuing,
      pulse: {
        online: counts.online,
        live: counts.playing,
        open: Math.max(0, counts.open - myWaiting),
        gamesPlayed: (await t.counters.get(["games"])).games,
      },
      openReports: reports.filter((r) => r.status !== "RESOLVED" && r.status !== "REJECTED").length,
    };
  });
}

export type HomeData = Awaited<ReturnType<typeof homeData>>;
