import { afterEach, describe, expect, it, vi } from "vitest";
import { createTable } from "@/lib/server/lobby";
import {
  ABANDON_MS,
  BOTH_GONE_MS,
  HOST_RETURN_MS,
  OFFLINE_GAME_MS,
  createMatch,
  getSnapshot,
  joinMatch,
  leaveMatch,
  setEnvForTests,
  sweep,
  voidMatchIn,
} from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureUser, profileOf } from "@/lib/server/users";
import { randomEnv } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function liveMatch(seed: number) {
  setEnvForTests(randomEnv(seed));
  const host = await ensureUser(undefined);
  const guest = await ensureUser(undefined);
  const { matchId } = await createTable(host.id, { targetPoints: 3 });
  await joinMatch(guest.id, matchId);
  await getSnapshot(host.id, matchId); // the host is at the board
  const ids = [host.id, guest.id];
  return { host, guest, matchId, ids };
}

describe("left games (A1, A6)", () => {
  it("the player to act loses by abandonment after 10 minutes away while the opponent waits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { matchId, ids } = await liveMatch(21);
    const toAct = (await getSnapshot(ids[0], matchId)).seatToAct!;
    const waiting = ids[1 - toAct];
    later(ABANDON_MS / 2);
    await getSnapshot(waiting, matchId);
    later(ABANDON_MS / 2 + 1000);
    const s = await getSnapshot(waiting, matchId);
    expect(s.status).toBe("COMPLETED");
    expect(s.endReason).toBe("abandoned");
    expect(s.winner).toBe(1 - toAct);
    expect((await profileOf(waiting)).stats).toMatchObject({ played: 1, wins: 1 });
    expect((await profileOf(ids[toAct])).stats).toMatchObject({ played: 1, wins: 0 });
  });

  it("a match both players left closes after 30 minutes with no result", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { matchId, ids } = await liveMatch(22);
    await getSnapshot(ids[1], matchId);
    later(BOTH_GONE_MS + 1000);
    expect(await sweep(Date.now(), true)).toBe(1);
    const s = await getSnapshot(ids[0], matchId);
    expect(s).toMatchObject({ status: "CANCELLED", closedReason: "abandoned" });
    expect((await profileOf(ids[0])).stats.played).toBe(0);
  });

  it("someone joins while the host is away: called off if the host is not back in 2 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setEnvForTests(randomEnv(23));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    later(60_000); // host's phone went to the background
    await joinMatch(guest.id, matchId);
    const s = await getSnapshot(guest.id, matchId);
    expect(s.status).toBe("ACTIVE");
    expect(Date.parse(s.hostReturnBy!)).toBeGreaterThan(Date.now());
    later(HOST_RETURN_MS + 1000);
    expect(await getSnapshot(guest.id, matchId)).toMatchObject({ status: "CANCELLED", closedReason: "host-missing" });
    await createMatch(guest.id, "bot", 1); // the joiner is free again
  });

  it("the host coming back in time keeps the match", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setEnvForTests(randomEnv(24));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    later(60_000);
    await joinMatch(guest.id, matchId);
    later(HOST_RETURN_MS / 2);
    expect((await getSnapshot(host.id, matchId)).hostReturnBy).toBeNull();
    later(HOST_RETURN_MS);
    expect((await getSnapshot(guest.id, matchId)).status).toBe("ACTIVE");
  });

  it("computer and pass & play games close after a day alone, with no result", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await ensureUser(undefined);
    const { matchId } = await createMatch(u.id, "bot", 3);
    later(OFFLINE_GAME_MS - 60_000);
    expect((await getSnapshot(u.id, matchId)).status).toBe("ACTIVE");
    later(120_000);
    await sweep(Date.now(), true);
    expect(await getSnapshot(u.id, matchId)).toMatchObject({ status: "CANCELLED", closedReason: "inactive" });
  });
});

describe("results (A4)", () => {
  it("records each player's result once, pages history, and removes voided matches", async () => {
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      setEnvForTests(randomEnv(30 + i));
      const { matchId } = await createTable(a.id, { targetPoints: 1 });
      await joinMatch(b.id, matchId);
      // b loses the first eight, a loses the last four.
      await leaveMatch(i < 8 ? b.id : a.id, matchId);
      ids.push(matchId);
    }
    const sa = (await profileOf(a.id)).stats;
    expect(sa).toMatchObject({ played: 12, wins: 8, losses: 4, currentStreak: 0, bestStreak: 8 });
    expect(sa.history).toHaveLength(10);
    expect(sa.historyMore).toBe(true);
    expect((await profileOf(b.id)).stats).toMatchObject({ wins: 4, currentStreak: 4 });

    await tx((t) => voidMatchIn(t, ids[11], a.id, "test"));
    expect((await profileOf(b.id)).stats).toMatchObject({ played: 11, wins: 3, currentStreak: 3 });
  });
});
