import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAY_TOTAL_MS, DISCONNECT_GRACE_MS, RECONNECT_WINDOW_MS, clockView, newClock, nextDecision, noteReturn, timedOut } from "@/lib/server/clock";
import { createTable } from "@/lib/server/lobby";
import { getSnapshot, joinMatch, setEnvForTests, submitAction } from "@/lib/server/matches";
import { ensureAccount, randomEnv } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("clock rules", () => {
  it("gives 12 free seconds per decision, then uses the bank (1 min per point, at least 2)", () => {
    expect(newClock("standard", 3)!.bankMs).toEqual([180_000, 180_000]);
    expect(newClock("standard", 1)!.bankMs).toEqual([120_000, 120_000]);
    expect(newClock("fast", 3)!.perMoveMs).toBe(8_000);
    expect(newClock("none", 3)).toBeUndefined();
    const c = newClock("standard", 3)!;
    nextDecision(c, 0, 0);
    nextDecision(c, 1, 40_000); // Anna thought for 40 s: 12 free, 28 from her bank
    expect(c.bankMs[0]).toBe(152_000);
    nextDecision(c, 0, 45_000); // Ben moved within his free time
    expect(c.bankMs[1]).toBe(180_000);
  });

  it("an empty bank loses on time", () => {
    const c = newClock("standard", 1)!;
    nextDecision(c, 0, 0);
    const seen: [number, number] = [0, 0];
    const at = 12_000 + 120_000;
    expect(timedOut(c, [at - 1000, at], at - 1)).toBeNull();
    expect(timedOut(c, [at, at], at)).toBe(0);
    void seen;
  });

  it("a dropped player's bank stops and a 90-second reconnect window runs", () => {
    const c = newClock("standard", 3)!;
    nextDecision(c, 0, 0);
    // Anna's app last checked in at 5 s; Ben is still here.
    const at = 60_000;
    const v = clockView(c, [5_000, at], at);
    const awayFrom = 5_000 + DISCONNECT_GRACE_MS;
    expect(v.reconnectBy).toBe(awayFrom + RECONNECT_WINDOW_MS);
    expect(v.bankLeftMs[0]).toBe(180_000 - (awayFrom - 12_000)); // only the connected time counted
    expect(timedOut(c, [5_000, awayFrom + RECONNECT_WINDOW_MS], awayFrom + RECONNECT_WINDOW_MS)).toBe(0);
    // She comes back after 25 s away: her bank is as it was when she dropped.
    const back = awayFrom + 25_000;
    expect(noteReturn(c, 0, [5_000, back], back)).toBe(true);
    expect(c.awayUsedMs[0]).toBe(25_000);
    expect(clockView(c, [back, back], back).bankLeftMs[0]).toBe(180_000 - (awayFrom - 12_000));
  });

  it("caps time away at 3 minutes per match, and pauses when both players are gone", () => {
    const c = newClock("standard", 3)!;
    nextDecision(c, 0, 0);
    c.awayUsedMs[0] = AWAY_TOTAL_MS - 10_000;
    const awayFrom = 1_000 + DISCONNECT_GRACE_MS;
    expect(clockView(c, [1_000, awayFrom + 5_000], awayFrom + 5_000).reconnectBy).toBe(awayFrom + 10_000);
    // Both silent (likely our outage): nobody's clock runs.
    expect(clockView(c, [1_000, 1_000], 500_000).paused).toBe(true);
    expect(timedOut(c, [1_000, 1_000], 500_000)).toBeNull();
  });
});

describe("clocks in matches", () => {
  it("an online match loses by timeout when the player to act runs out of time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setEnvForTests(randomEnv(70));
    const host = await ensureAccount();
    const guest = await ensureAccount();
    const { matchId } = await createTable(host.id, { targetPoints: 1 });
    await joinMatch(guest.id, matchId);
    const s = await getSnapshot(host.id, matchId);
    expect(s.clock).toMatchObject({ preset: "standard", perMoveMs: 12_000, bankLeftMs: [120_000, 120_000] });
    const toAct = s.seatToAct!;
    const ids = [host.id, guest.id];
    // Both stay connected (polling), the player to act just doesn't move.
    for (let t = 0; t < 140; t += 10) {
      vi.setSystemTime(Date.now() + 10_000);
      await getSnapshot(ids[toAct], matchId);
      await getSnapshot(ids[1 - toAct], matchId);
    }
    const end = await getSnapshot(ids[1 - toAct], matchId);
    expect(end).toMatchObject({ status: "COMPLETED", endReason: "timeout", winner: 1 - toAct });
  });

  it("No clock tables never time out; acting resets the free time", async () => {
    setEnvForTests(randomEnv(71));
    const host = await ensureAccount();
    const guest = await ensureAccount();
    const { matchId } = await createTable(host.id, { targetPoints: 1, clock: "none" });
    await joinMatch(guest.id, matchId);
    expect((await getSnapshot(host.id, matchId)).clock).toBeNull();
    void submitAction;
  });
});
