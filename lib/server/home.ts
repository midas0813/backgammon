import type { Seat } from "../engine/board";
import { userBalances } from "./ledger";
import { HOST_ONLINE_MS } from "./matches";
import { ONLINE_WINDOW_MS, touchUser } from "./lobby";
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
export function homeData(userId: string, tzOffset: number) {
  return tx(async (t) => {
    const now = Date.now();
    await touchUser(t, userId, now);
    const profile = await profileIn(t, userId);
    const balances = await userBalances(t, userId);
    const pendingDeposits = (await t.deposits.listByUser(userId))
      .filter((d) => d.status === "PENDING" || d.status === "CONFIRMED")
      .reduce((s, d) => s + d.tokenUnits, 0);

    const matches = await t.matches.listForUser(userId);
    const dayStart = startOfLocalDay(now, tzOffset);
    let wins = 0,
      points = 0,
      games = 0;
    const finishedToday = matches.filter((m) => m.mode !== "local" && m.completedAt && Date.parse(m.completedAt) >= dayStart);
    for (const m of finishedToday) {
      const seat = m.seats.indexOf(userId) as Seat;
      if (m.state.winner === seat) wins++;
      for (const r of m.state.results) {
        games++;
        if (r.winner === seat) points += r.points;
      }
    }
    const continuing = matches
      .filter((m) => m.state.status === "ACTIVE" || m.state.status === "WAITING")
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 6)
      .map((m) => {
        const seat = Math.max(0, m.seats.indexOf(userId)) as Seat;
        const opp = (1 - seat) as Seat;
        return {
          matchId: m.id,
          mode: m.mode,
          status: m.state.status,
          targetPoints: m.state.targetPoints,
          opponent: m.mode === "local" ? "Pass & play" : m.state.status === "WAITING" ? null : m.names[opp],
          score: [m.state.score[seat], m.state.score[opp]] as [number, number],
          yourTurn: m.state.status === "ACTIVE" && m.state.game !== null && m.state.game.turn === seat && m.mode !== "local",
        };
      });

    const waiting = await t.matches.listLobby("WAITING", 100);
    const stats = await t.matches.stats();
    const reports = await t.disputes.listByUser(userId);
    return {
      profile,
      balances: { ...balances, pendingDeposits },
      today: {
        matches: finishedToday.length,
        wins,
        losses: finishedToday.length - wins,
        games,
        points,
        goal: DAILY_GOAL,
        dayStart: new Date(dayStart).toISOString(),
      },
      continuing,
      pulse: {
        online: await t.users.countSeenSince(now - ONLINE_WINDOW_MS),
        live: stats.live,
        open: waiting.filter((r) => r.hostId !== userId && r.hostSeenAt >= now - HOST_ONLINE_MS).length,
        gamesPlayed: stats.games,
      },
      openReports: reports.filter((r) => r.status !== "RESOLVED" && r.status !== "REJECTED").length,
    };
  });
}

export type HomeData = Awaited<ReturnType<typeof homeData>>;
