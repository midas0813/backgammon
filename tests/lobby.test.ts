import { describe, expect, it, vi } from "vitest";
import { homeData, startOfLocalDay } from "@/lib/server/home";
import { PAGE_SIZE, TABLE_EXPIRY_MS, createTable, lobby, publicTables, tableStatus } from "@/lib/server/lobby";
import { tx } from "@/lib/server/store";
import { cancelMatch, getSnapshot, joinMatch, setSpectatorSettings, setEnvForTests, submitAction, sweep } from "@/lib/server/matches";
import { ensureUser } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";

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
    const friend = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const pub = await createTable(host.id, { targetPoints: 3, visibility: "public" });
    const priv = await createTable(friend.id, { targetPoints: 5, visibility: "private" });

    const seen = await publicTables({});
    expect(seen.tables.map((t) => t.matchId)).toEqual([pub.matchId]); // private tables are never listed
    expect(seen.tables[0].host.name).toBe(host.name);
    expect((await lobby(guest.id)).counts.open).toBe(1);
    expect((await lobby(host.id)).counts.open).toBe(0); // your own table is not "open to join" for you
    expect((await lobby(host.id)).mine.map((m) => m.matchId)).toEqual([pub.matchId]);
    expect((await lobby(friend.id)).mine.map((m) => m.matchId)).toEqual([priv.matchId]);
    expect((await publicTables({ points: "5" })).tables).toEqual([]);

    await joinMatch(guest.id, pub.matchId);
    expect((await publicTables({})).tables).toEqual([]);
    const live = await publicTables({ view: "live" });
    expect(live.tables.map((l) => l.matchId)).toEqual([pub.matchId]);
    expect(live.tables[0].opponent?.name).toBe(guest.name);
    expect((await lobby(guest.id)).counts.live).toBe(1);
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

  it("one table per player, and only supported lengths", async () => {
    const host = await ensureUser(undefined);
    await createTable(host.id, { targetPoints: 1 });
    expect(await codeOf(createTable(host.id, { targetPoints: 7, visibility: "private" }))).toBe("ALREADY_IN_GAME");
    expect(await codeOf(createTable((await ensureUser(undefined)).id, { targetPoints: 4 }))).toBe("INVALID_INPUT");
  });

  it("keeps an away host's table listed, then closes it; invite-only tables close after 15 minutes", async () => {
    const host = await ensureAccount();
    const friend = await ensureUser(undefined);
    const other = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    const invite = await createTable(friend.id, { targetPoints: 3, visibility: "private" });
    expect((await publicTables({})).tables[0]).toMatchObject({ matchId, hostOnline: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3 * 60 * 1000); // host's phone in the background: listed as away
      expect((await publicTables({})).tables[0]).toMatchObject({ matchId, hostOnline: false });
      expect((await tableStatus(host.id, [matchId])).tables[0].status).toBe("WAITING"); // host is back
      vi.setSystemTime(Date.now() + 13 * 60 * 1000); // 16 min: the invite was never accepted
      await sweep(Date.now(), true);
      expect((await getSnapshot(friend.id, invite.matchId)).closedReason).toBe("expired");
      expect((await getSnapshot(host.id, matchId)).status).toBe("WAITING");
      vi.setSystemTime(Date.now() + TABLE_EXPIRY_MS + 1000); // host long gone: closed as expired
      await lobby(other.id);
      await sweep(Date.now(), true);
      expect((await getSnapshot(host.id, matchId)).closedReason).toBe("expired");
      // The host is free to open a new table.
      await createTable(host.id, { targetPoints: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a public table closes after an hour even with the host around", async () => {
    const host = await ensureAccount();
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let m = 10; m <= 60; m += 10) {
        vi.setSystemTime(Date.now() + 10 * 60 * 1000);
        await tableStatus(host.id, [matchId]); // the host's app keeps checking in
      }
      vi.setSystemTime(Date.now() + 1000);
      expect((await getSnapshot(host.id, matchId)).closedReason).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the host when their table is joined", async () => {
    setEnvForTests(randomEnv(13));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createTable(a.id, { targetPoints: 3 });
    await joinMatch(b.id, matchId);
    expect((await tableStatus(a.id, [matchId])).tables[0]).toMatchObject({ status: "ACTIVE", opponent: b.name });
    expect((await tableStatus(b.id, [matchId])).tables).toEqual([]); // only the host's own tables
  });

  it("cancelled tables leave the lobby", async () => {
    const host = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3 });
    await cancelMatch(host.id, matchId);
    expect((await publicTables({})).tables).toEqual([]);
  });
});

describe("room browser", () => {
  it("filters by length and entry fee, sorts, and pages through many tables", async () => {
    const lengths = [1, 3, 5, 7];
    const ids: string[] = [];
    // 40 hosts with one table each (one game per player).
    for (let i = 0; i < 40; i++) {
      const host = await ensureUser(undefined);
      ids.push((await createTable(host.id, { targetPoints: lengths[i % 4] })).matchId);
    }
    // Give a few tables an entry fee so the fee bands have something to find.
    await tx(async (t) => {
      for (const [i, fee] of [
        [0, 500],
        [1, 2500],
        [2, 9000],
      ] as const) {
        const rec = (await t.matches.get(ids[i]))!;
        rec.entryFee = fee;
        await t.matches.put(rec);
      }
    });
    const all = await publicTables({});
    expect(all.total).toBe(40);
    expect(all.pages).toBe(Math.ceil(40 / PAGE_SIZE));
    expect(all.tables).toHaveLength(PAGE_SIZE);
    const p2 = await publicTables({ page: "2" });
    expect(p2.tables).toHaveLength(40 - 2 * PAGE_SIZE);
    // Pages never overlap and together cover everything.
    const seen = new Set<string>();
    for (let page = 0; page < all.pages; page++) for (const t of (await publicTables({ page: String(page) })).tables) seen.add(t.matchId);
    expect(seen.size).toBe(40);

    expect((await publicTables({ points: "5" })).total).toBe(10);
    expect((await publicTables({ fee: "free" })).total).toBe(37);
    expect((await publicTables({ fee: "1-10" })).tables.map((t) => t.entryFee)).toEqual([500]);
    expect((await publicTables({ fee: "10-50" })).tables.map((t) => t.entryFee)).toEqual([2500]);
    expect((await publicTables({ fee: "50+" })).tables.map((t) => t.entryFee)).toEqual([9000]);
    const oldest = await publicTables({ sort: "oldest" });
    const newest = await publicTables({ sort: "newest" });
    expect(oldest.tables[0].createdAt <= newest.tables[0].createdAt).toBe(true);
    // Unknown values fall back to safe defaults.
    expect((await publicTables({ points: "4", fee: "lots", page: "-3" })).total).toBe(40);
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
    expect(await codeOf(submitAction(viewer.id, matchId, { actionId: "x", expectedVersion: view.stateVersion, actionType: "ROLL" }))).toBe("NOT_PARTICIPANT");

    expect(await codeOf(setSpectatorSettings(viewer.id, matchId, { allow: false }))).toBe("NOT_PARTICIPANT");
    expect(await codeOf(setSpectatorSettings(guest.id, matchId, { allow: false }))).toBe("NOT_PARTICIPANT"); // host only
    await setSpectatorSettings(host.id, matchId, { allow: false });
    expect(await codeOf(getSnapshot(viewer.id, matchId))).toBe("NOT_PARTICIPANT");
    expect((await publicTables({ view: "live" })).tables).toEqual([]);
  });

  it("tables created with watching off are not listed live", async () => {
    setEnvForTests(randomEnv(15));
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3, allowSpectators: false });
    await joinMatch(guest.id, matchId);
    expect((await publicTables({ view: "live" })).tables).toEqual([]);
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
    expect(before.balances.freeCredits).toBe(0); // guests have no credits
    expect(before.continuing.map((c) => c.matchId)).toEqual([matchId]);
    expect(before.today).toMatchObject({ matches: 0, goal: 3 });

    const snap = await getSnapshot(b.id, matchId);
    await submitAction(b.id, matchId, { actionId: "f", expectedVersion: snap.stateVersion, actionType: "FORFEIT_MATCH", payload: { confirm: true } });
    const after = await homeData(a.id, 0);
    expect(after.today).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    expect(after.continuing).toEqual([]);
  });
});
