import { afterEach, describe, expect, it, vi } from "vitest";
import { closeWeek, decidePrizeWeekIn, leaderboard, prizeSplit } from "@/lib/server/leaderboard";
import { reconcile, userBalances } from "@/lib/server/ledger";
import { createTable } from "@/lib/server/lobby";
import { joinMatch, leaveMatch, setEnvForTests, submitAction, getSnapshot } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureUser } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";
import { currentSequences } from "@/lib/engine/match";

afterEach(() => vi.useRealTimers());

/** Play one game to the end, then the loser resigns the rest: a "real" result. */
async function playOneGameThenResign(winnerHost: boolean, hostId: string, guestId: string, points = 1, seed = 1) {
  setEnvForTests(randomEnv(seed));
  const { matchId } = await createTable(hostId, { targetPoints: points, clock: "none" });
  await joinMatch(guestId, matchId);
  // Play random legal turns until the first game ends.
  for (let i = 0; i < 3000; i++) {
    const s = await getSnapshot(hostId, matchId);
    if (s.status !== "ACTIVE" || s.results.length > 0) break;
    const actor = s.seatToAct === 0 ? hostId : guestId;
    const g = s.game!;
    const base = { actionId: `a${seed}-${i}`, expectedVersion: s.stateVersion };
    if (g.phase === "BEFORE_ROLL") await submitAction(actor, matchId, { ...base, actionType: "ROLL" });
    else if (g.phase === "ROLLED") await submitAction(actor, matchId, { ...base, actionType: "CONFIRM_TURN", payload: { moves: currentSequences(g)[0] } });
    else break;
  }
  const s = await getSnapshot(hostId, matchId);
  if (s.status === "ACTIVE") await leaveMatch(winnerHost ? guestId : hostId, matchId);
  return matchId;
}

describe("leaderboard points", () => {
  it("scores real online results, ignores instant forfeits, and caps games against the same opponent", async () => {
    const a = await ensureAccount();
    const b = await ensureAccount();
    // An instant forfeit (no game played) earns nothing.
    setEnvForTests(randomEnv(1));
    const t0 = await createTable(a.id, { targetPoints: 3, clock: "none" });
    await joinMatch(b.id, t0.matchId);
    await leaveMatch(b.id, t0.matchId);
    let rows = await tx((t) => t.results.history(a.id, 0, 10));
    expect(rows[0].lbPoints).toBe(0);

    for (let i = 0; i < 4; i++) await playOneGameThenResign(true, a.id, b.id, 1, 10 + i);
    rows = await tx((t) => t.results.history(a.id, 0, 10));
    const pts = rows.slice(0, 4).map((r) => r.lbPoints);
    expect(pts.filter((p) => p! > 0)).toHaveLength(2); // the forfeit above + 2 games = 3 that day; the 4th and 5th earn nothing
    const board = await leaderboard(a.id, "week");
    expect(board.me?.points).toBe(rows.reduce((n, r) => n + (r.lbPoints ?? 0), 0));
    expect(board.me?.rank).toBeGreaterThanOrEqual(1);
  });

  it("splits the pool 50/30/20", () => {
    expect(prizeSplit(5000, [50, 30, 20])).toEqual([2500, 1500, 1000]);
    expect(prizeSplit(1001, [50, 30, 20])).toEqual([501, 300, 200]);
  });
});

describe("weekly prizes", () => {
  it("proposes eligible winners after the week, and pays them once approved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 13, 12)); // Tuesday
    const star = await ensureAccount();
    const guest = await ensureUser(undefined); // no wallet: never eligible
    const opponents = [];
    for (let i = 0; i < 5; i++) opponents.push(await ensureAccount());
    for (let i = 0; i < 5; i++) await playOneGameThenResign(true, star.id, opponents[i].id, 1, 20 + i);
    await playOneGameThenResign(true, guest.id, opponents[0].id, 1, 40);

    const live = await leaderboard(star.id, "week");
    expect(live.me).toMatchObject({ eligible: true, opponents: 5 });
    expect(live.rows.find((r) => r.me)?.prize).toBe(2500);

    vi.setSystemTime(Date.UTC(2026, 9, 20, 1)); // the next Tuesday
    const week = (await closeWeek())!;
    expect(week).toMatchObject({ weekKey: "2026-10-12", status: "PENDING_REVIEW" });
    expect(week.winners[0]).toMatchObject({ userId: star.id, place: 1, units: 2500 });
    expect(week.winners.some((w) => w.userId === guest.id)).toBe(false);
    expect(await closeWeek()).toBeNull(); // proposed once

    await tx((t) => decidePrizeWeekIn(t, "2026-10-12", true, star.id));
    expect((await tx((t) => userBalances(t, star.id))).available).toBe(2500);
    expect(await tx(reconcile)).toEqual([]);
    await expect(tx((t) => decidePrizeWeekIn(t, "2026-10-12", true, star.id))).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });
});
