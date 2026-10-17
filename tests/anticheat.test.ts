import { describe, expect, it } from "vitest";
import { coefficientOfVariation, decisionTimes, hashIp, THRESHOLDS } from "@/lib/server/anticheat";
import { createTable } from "@/lib/server/lobby";
import { joinMatch, leaveMatch, setEnvForTests } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { resolveSession } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";

async function quickMatch(winner: { id: string }, loser: { id: string }, seed: number) {
  setEnvForTests(randomEnv(seed));
  const { matchId } = await createTable(winner.id, { targetPoints: 1, clock: "none" });
  await joinMatch(loser.id, matchId);
  await leaveMatch(loser.id, matchId); // loser forfeits
  return matchId;
}

const flags = () => tx((t) => t.flags.list(undefined, 50));

describe("anti-cheat flags", () => {
  it("flags repeated forfeits to the same opponent, and its matches leave the prize count until decided", async () => {
    const a = await ensureAccount();
    const b = await ensureAccount();
    const ids = [];
    for (let i = 0; i < THRESHOLDS.thrownLosses; i++) ids.push(await quickMatch(a, b, 90 + i));
    const f = (await flags()).find((x) => x.kind === "thrown-losses");
    expect(f).toMatchObject({ status: "OPEN", userIds: [b.id, a.id] });
    const rows = await tx((t) => t.results.history(a.id, 0, 5));
    expect(rows.find((r) => r.matchId === f!.matchIds[0])?.flagged).toBe(true);
    // Raised once per day for the same players.
    await quickMatch(a, b, 99);
    expect((await flags()).filter((x) => x.kind === "thrown-losses")).toHaveLength(1);
  });

  it("flags the same two players many times a day, and opponents on one network", async () => {
    const a = await ensureAccount();
    const b = await ensureAccount();
    const ip = hashIp("203.0.113.9");
    await tx(async (t) => {
      await t.users.touchSeen(a.id, Date.now(), ip);
      await t.users.touchSeen(b.id, Date.now(), ip);
    });
    for (let i = 0; i < THRESHOLDS.samePairPerDay; i++) await quickMatch(i % 2 ? a : b, i % 2 ? b : a, 100 + i);
    const kinds = new Set((await flags()).map((f) => f.kind));
    expect(kinds.has("same-pair")).toBe(true);
    expect(kinds.has("same-network")).toBe(true);
  });

  it("flags many accounts created from one network in a day", async () => {
    const ip = hashIp("198.51.100.7");
    for (let i = 0; i < THRESHOLDS.guestsPerNetworkPerDay; i++) await resolveSession(undefined, ip);
    expect((await flags()).some((f) => f.kind === "account-farm")).toBe(true);
    expect(ip).not.toContain("198.51"); // only a salted hash is kept
  });

  it("measures decision times and their variation", () => {
    const t0 = Date.parse("2026-10-18T10:00:00Z");
    const ev = (type: string, ms: number, payload: Record<string, unknown>) => ({ type, serverTime: new Date(t0 + ms).toISOString(), payload });
    const times = decisionTimes([
      ev("DICE_ROLLED", 0, { seat: 0 }),
      ev("TURN_COMMITTED", 4000, { seat: 0 }),
      ev("DICE_ROLLED", 5000, { seat: 1 }),
      ev("TURN_COMMITTED", 5100, { seat: 1, forced: true }),
      ev("DICE_ROLLED", 6000, { seat: 0 }),
      ev("TURN_COMMITTED", 10000, { seat: 0 }),
    ]);
    expect(times).toEqual([[4000, 4000], []]);
    expect(coefficientOfVariation([4000, 4000, 4000])).toBe(0);
    expect(coefficientOfVariation([1000, 9000])).toBeGreaterThan(0.5);
  });
});
