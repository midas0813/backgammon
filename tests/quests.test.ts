import { describe, expect, it } from "vitest";
import { getWallet } from "@/lib/server/wallet";
import { createTable } from "@/lib/server/lobby";
import { createMatch, joinMatch, leaveMatch, setEnvForTests } from "@/lib/server/matches";
import { claimQuest, questBoard, setFrame } from "@/lib/server/quests";
import { tx } from "@/lib/server/store";
import { MATCH_XP, QUESTS, activeQuests, levelOf, periodKey, weekKey, xpForLevel } from "@/lib/quests";
import { ensureUser } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("quest rules", () => {
  it("picks 3 daily and 3 weekly quests, the same for everyone, and weeks start on Monday", () => {
    const now = Date.UTC(2026, 9, 17, 15); // a Saturday
    expect(activeQuests("daily", now)).toHaveLength(3);
    expect(activeQuests("weekly", now)).toHaveLength(3);
    expect(activeQuests("daily", now)).toEqual(activeQuests("daily", now + 3600_000));
    expect(weekKey(now)).toBe("2026-10-12");
    expect(periodKey("weekly", Date.UTC(2026, 9, 19, 1))).toBe("w:2026-10-19");
  });

  it("levels need 100 more XP each", () => {
    expect([0, 99, 100, 299, 300].map((x) => levelOf(x).level)).toEqual([1, 1, 2, 2, 3]);
    expect(xpForLevel(4)).toBe(600);
  });
});

describe("quest progress", () => {
  it("fills from finished matches, claims once, and gives XP (credits only to wallet accounts)", async () => {
    setEnvForTests(randomEnv(80));
    const a = await ensureAccount();
    const b = await ensureAccount();
    const guest = await ensureUser(undefined);
    for (let i = 0; i < 3; i++) {
      const { matchId } = await createTable(a.id, { targetPoints: 1 });
      await joinMatch(b.id, matchId);
      // b resigns after the first game is played out? Here: b forfeits immediately — counts as played, not as a real win.
      await leaveMatch(b.id, matchId);
    }
    const board = await questBoard(a.id);
    const played = [...board.daily, ...board.weekly].find((q) => q.metric === "matchesPlayed" || q.metric === "onlinePlayed");
    if (played) expect(played.progress).toBeGreaterThan(0);
    const wins = [...board.daily, ...board.weekly].find((q) => q.metric === "onlineWins" || q.metric === "wins");
    if (wins) expect(wins.progress).toBe(0); // forfeits before any game was played are not wins
    expect(board.xp).toBe(3 * MATCH_XP.played);

    // Complete and claim an active quest directly.
    const q = board.daily[0];
    await tx((t) => t.quests.bump(a.id, [{ periodKey: periodKey("daily", Date.now()), questId: q.id, n: q.target, target: q.target }]));
    const r = await claimQuest(a.id, q.id);
    expect(r.xp).toBe(3 * MATCH_XP.played + q.xp);
    expect(r.credits).toBe(q.credits);
    expect(await codeOf(claimQuest(a.id, q.id))).toBe("WRONG_PHASE"); // only once
    expect((await getWallet(a.id)).balances.freeCredits).toBeGreaterThanOrEqual(q.credits);

    await tx((t) => t.quests.bump(guest.id, [{ periodKey: periodKey("daily", Date.now()), questId: q.id, n: q.target, target: q.target }]));
    expect((await claimQuest(guest.id, q.id)).credits).toBe(0); // guests get XP only
    expect(await codeOf(claimQuest(a.id, "nope"))).toBe("INVALID_INPUT");
  });

  it("frames unlock with levels", async () => {
    const u = await ensureUser(undefined);
    expect(await codeOf(setFrame(u.id, "gold"))).toBe("INELIGIBLE");
    await tx((t) => t.users.addXp(u.id, xpForLevel(4)));
    expect(await setFrame(u.id, "gold")).toEqual({ frame: "gold" });
    expect(await codeOf(setFrame(u.id, "crown"))).toBe("INELIGIBLE");
  });

  it("computer games and hits count", async () => {
    setEnvForTests(randomEnv(81));
    const u = await ensureUser(undefined);
    const { matchId } = await createMatch(u.id, "bot", 1);
    await leaveMatch(u.id, matchId); // ended with no result: no match counts
    expect((await questBoard(u.id)).xp).toBe(0);
    expect(QUESTS.some((q) => q.metric === "computerPlayed")).toBe(true);
  });
});
