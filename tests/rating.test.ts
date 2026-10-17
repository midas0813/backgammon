import { describe, expect, it } from "vitest";
import { ratingBoard } from "@/lib/server/leaderboard";
import { createTable } from "@/lib/server/lobby";
import { getSnapshot, joinMatch, leaveMatch, setEnvForTests, submitAction } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { kFactor, ratingChange, winChance } from "@/lib/rating";
import { currentSequences } from "@/lib/engine/match";
import { ensureAccount, randomEnv } from "./helpers";

describe("rating formula (FIBS)", () => {
  it("equal players: 50%; the favourite gains less for winning", () => {
    expect(winChance(1500, 1500, 5)).toBeCloseTo(0.5);
    expect(winChance(1700, 1500, 5)).toBeGreaterThan(0.6);
    const [upsetGain] = ratingChange({ rating: 1400, experience: 1000 }, { rating: 1600, experience: 1000 }, 3);
    const [favGain] = ratingChange({ rating: 1600, experience: 1000 }, { rating: 1400, experience: 1000 }, 3);
    expect(upsetGain).toBeGreaterThan(favGain);
    expect(kFactor(0)).toBe(5);
    expect(kFactor(1000)).toBe(1);
  });
});

describe("ranked matches", () => {
  it("move both ratings after a real game; instant forfeits and unranked tables don't", async () => {
    const a = await ensureAccount();
    const b = await ensureAccount();
    // Instant forfeit: no change.
    setEnvForTests(randomEnv(300));
    let t = await createTable(a.id, { targetPoints: 1 });
    await joinMatch(b.id, t.matchId);
    await leaveMatch(b.id, t.matchId);
    expect((await tx((x) => x.users.get(a.id)))?.ratingGames ?? 0).toBe(0);

    // Play one real game to the end.
    setEnvForTests(randomEnv(301));
    t = await createTable(a.id, { targetPoints: 1 });
    await joinMatch(b.id, t.matchId);
    for (let i = 0; i < 3000; i++) {
      const s = await getSnapshot(a.id, t.matchId);
      if (s.status !== "ACTIVE") break;
      const actor = s.seatToAct === 0 ? a.id : b.id;
      const g = s.game!;
      const base = { actionId: `r${i}`, expectedVersion: s.stateVersion };
      if (g.phase === "BEFORE_ROLL") await submitAction(actor, t.matchId, { ...base, actionType: "ROLL" });
      else await submitAction(actor, t.matchId, { ...base, actionType: "CONFIRM_TURN", payload: { moves: currentSequences(g)[0] } });
    }
    const [ua, ub] = await tx(async (x) => [await x.users.get(a.id), await x.users.get(b.id)]);
    expect(ua?.ratingGames).toBe(1);
    expect(ub?.ratingGames).toBe(1);
    expect((ua!.rating! - 1500) * (ub!.rating! - 1500)).toBeLessThan(0); // one up, one down
    const board = await ratingBoard(a.id);
    expect(board.rows).toHaveLength(2);
    expect(board.me).toMatchObject({ games: 1, provisional: true });

    // Unranked (no clock) tables leave ratings alone.
    setEnvForTests(randomEnv(302));
    t = await createTable(a.id, { targetPoints: 1, clock: "none" });
    expect((await getSnapshot(a.id, t.matchId)).ranked).toBe(false);
  });
});
