import { describe, expect, it, vi } from "vitest";
import { homeData, startOfLocalDay } from "@/lib/server/home";
import { MAX_OPEN_TABLES, TABLE_EXPIRY_MS, createTable, findGame, lobby, tableStatus } from "@/lib/server/lobby";
import { cancelMatch, getSnapshot, joinMatch, setAllowSpectators, setEnvForTests, submitAction } from "@/lib/server/matches";
import { ensureUser } from "@/lib/server/users";
import { randomEnv } from "./helpers";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("lobby tables", () => {
  it("lists public tables to others, hides private ones, and moves joined tables to Live", async () => {
    setEnvForTests(randomEnv(11));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const pub = await createTable(host.id, { targetPoints: 3, visibility: "public" });
    const priv = await createTable(host.id, { targetPoints: 5, visibility: "private" });

    const seen = await lobby(guest.id);
    expect(seen.open.map((t) => t.matchId)).toEqual([pub.matchId]);
    expect(seen.open[0].host.name).toBe(host.name);
    expect((await lobby(host.id)).open).toEqual([]); // never your own
    expect((await lobby(host.id)).mine.map((m) => m.matchId).sort()).toEqual([pub.matchId, priv.matchId].sort());
    expect((await lobby(guest.id, { points: 5 })).open).toEqual([]);

    await joinMatch(guest.id, pub.matchId);
    const watcher = await ensureUser(undefined);
    const after = await lobby(watcher.id);
    expect(after.open).toEqual([]);
    expect(after.live.map((l) => l.matchId)).toEqual([pub.matchId]);
    expect(after.counts.live).toBe(1);
  });

  it("two players joining at once: exactly one gets the seat", async () => {
    setEnvForTests(randomEnv(12));
    const host = await ensureUser(undefined);
    const [a, b] = [await ensureUser(undefined), await ensureUser(undefined)];
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    const results = await Promise.allSettled([joinMatch(a.id, matchId), joinMatch(b.id, matchId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("EVENT_FULL");
  });

  it("limits open tables per player", async () => {
    const host = await ensureUser(undefined);
    for (let i = 0; i < MAX_OPEN_TABLES; i++) await createTable(host.id, { targetPoints: [1, 3, 5][i] });
    expect(await codeOf(createTable(host.id, { targetPoints: 7 }))).toBe("RATE_LIMITED");
    expect(await codeOf(createTable(host.id, { targetPoints: 4 }))).toBe("INVALID_INPUT");
  });

  it("hides tables whose host went away and expires them later", async () => {
    const host = await ensureUser(undefined);
    const other = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    expect((await lobby(other.id)).open.map((t) => t.matchId)).toEqual([matchId]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3 * 60 * 1000); // host quiet for 3 minutes: hidden, still open
      expect((await lobby(other.id)).open).toEqual([]);
      expect((await tableStatus(host.id, [matchId])).tables[0].status).toBe("WAITING");
      vi.setSystemTime(Date.now() + TABLE_EXPIRY_MS + 1000); // long gone: closed as expired
      await lobby(other.id);
      expect((await getSnapshot(host.id, matchId)).closedReason).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Find a game joins an available table, otherwise opens one", async () => {
    setEnvForTests(randomEnv(13));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const first = await findGame(a.id, 3);
    expect(first.joined).toBeUndefined();
    const second = await findGame(b.id, 3);
    expect(second).toEqual({ matchId: first.matchId, joined: true });
    expect((await tableStatus(a.id, [first.matchId])).tables[0]).toMatchObject({ status: "ACTIVE", opponent: b.name });
    expect((await tableStatus(b.id, [first.matchId])).tables).toEqual([]); // only the host's own tables
  });

  it("cancelled tables leave the lobby", async () => {
    const host = await ensureUser(undefined);
    const other = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    await cancelMatch(host.id, matchId);
    expect((await lobby(other.id)).open).toEqual([]);
  });
});

describe("spectators", () => {
  it("can watch but never act, are counted, and can be turned away by a player", async () => {
    setEnvForTests(randomEnv(14));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const viewer = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    await joinMatch(guest.id, matchId);

    const view = await getSnapshot(viewer.id, matchId);
    expect(view.role).toBe("spectator");
    expect(view.yourSeats).toEqual([]);
    expect((await getSnapshot(host.id, matchId)).spectators).toBe(1);
    expect(
      await codeOf(submitAction(viewer.id, matchId, { actionId: "x", expectedVersion: view.stateVersion, actionType: "ROLL" })),
    ).toBe("NOT_PARTICIPANT");

    expect(await codeOf(setAllowSpectators(viewer.id, matchId, false))).toBe("NOT_PARTICIPANT");
    await setAllowSpectators(guest.id, matchId, false);
    expect(await codeOf(getSnapshot(viewer.id, matchId))).toBe("NOT_PARTICIPANT");
    expect((await lobby(viewer.id)).live).toEqual([]);
  });

  it("tables created with watching off are not listed live", async () => {
    setEnvForTests(randomEnv(15));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3, allowSpectators: false });
    await joinMatch(guest.id, matchId);
    expect((await lobby((await ensureUser(undefined)).id)).live).toEqual([]);
  });
});

describe("home", () => {
  it("computes the start of the player's day from the browser offset", () => {
    const noonUtc = Date.UTC(2026, 9, 14, 12);
    expect(new Date(startOfLocalDay(noonUtc, 0)).toISOString()).toBe("2026-10-14T00:00:00.000Z");
    // UTC+9 (offset -540): local day began at 15:00 UTC the previous day.
    expect(new Date(startOfLocalDay(noonUtc, -540)).toISOString()).toBe("2026-10-13T15:00:00.000Z");
    // UTC-5 (offset 300): local day began at 05:00 UTC.
    expect(new Date(startOfLocalDay(noonUtc, 300)).toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });

  it("returns account status, today's progress and matches to continue", async () => {
    setEnvForTests(randomEnv(16));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createTable(a.id, { targetPoints: 1 });
    await joinMatch(b.id, matchId);
    const before = await homeData(a.id, 0);
    expect(before.profile.registered).toBe(false);
    expect(before.balances.freeCredits).toBeGreaterThan(0);
    expect(before.continuing.map((c) => c.matchId)).toEqual([matchId]);
    expect(before.today).toMatchObject({ matches: 0, goal: 3 });

    const snap = await getSnapshot(b.id, matchId);
    await submitAction(b.id, matchId, { actionId: "f", expectedVersion: snap.stateVersion, actionType: "FORFEIT_MATCH", payload: { confirm: true } });
    const after = await homeData(a.id, 0);
    expect(after.today).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    expect(after.continuing).toEqual([]);
  });
});
