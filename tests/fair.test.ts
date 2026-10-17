import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { dieFromDigest, fairMessage } from "@/lib/fair";
import { fairRecord } from "@/lib/server/fairCheck";
import { createMatch, forceBotDue, getSnapshot, joinMatch, leaveMatch, setEnvForTests, submitAction, tickBot } from "@/lib/server/matches";
import { createTable } from "@/lib/server/lobby";
import { ensureUser } from "@/lib/server/users";

afterEach(() => setEnvForTests(null));

/** What an independent checker does: the fingerprint, then every die from the revealed secret. */
function check(r: Awaited<ReturnType<typeof fairRecord>>) {
  const seed = r.fair.serverSeed!;
  const fingerprintOk = createHash("sha256").update(seed).digest("hex") === r.fair.commit;
  const expected = r.dice.map((_, n) => dieFromDigest(createHmac("sha256", seed).update(fairMessage(r.fair.clientSeeds, n)).digest()));
  return { fingerprintOk, matches: expected.every((d, i) => d === r.dice[i]) };
}

describe("provably fair dice", () => {
  it("keeps the secret sealed during play, reveals it after, and every die checks out", async () => {
    setEnvForTests(null);
    const host = await ensureUser(undefined);
    const guest = await ensureUser(undefined);
    const { matchId } = await createTable(host.id, { targetPoints: 3, clientSeed: "aa11" });
    await joinMatch(guest.id, matchId, "bb22");
    const during = await getSnapshot(host.id, matchId);
    expect(during.fair).toMatchObject({ clientSeeds: ["aa11", "bb22"], serverSeed: null });
    expect((await fairRecord(matchId)).fair.serverSeed).toBeNull();

    // Play a few rolls, then end the match.
    for (let i = 0; i < 6; i++) {
      const s = await getSnapshot(host.id, matchId);
      const actor = s.seatToAct === 0 ? host.id : guest.id;
      if (s.game?.phase === "BEFORE_ROLL") await submitAction(actor, matchId, { actionId: `r${i}`, expectedVersion: s.stateVersion, actionType: "ROLL" });
      else break;
    }
    await leaveMatch(host.id, matchId);
    const r = await fairRecord(matchId);
    expect(r.fair.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(r.dice.length).toBeGreaterThanOrEqual(2);
    expect(check(r)).toEqual({ fingerprintOk: true, matches: true });
    // A changed roll would not match.
    expect(check({ ...r, dice: r.dice.map((d, i) => (i === 0 ? (d % 6) + 1 : d)) }).matches).toBe(false);
  });

  it("computer games are verifiable too", async () => {
    setEnvForTests(null);
    const u = await ensureUser(undefined);
    const { matchId } = await createMatch(u.id, "bot", 1, { clientSeed: "cafe" });
    for (let i = 0; i < 4; i++) {
      await forceBotDue(matchId);
      await tickBot(matchId);
    }
    await leaveMatch(u.id, matchId);
    expect(check(await fairRecord(matchId))).toEqual({ fingerprintOk: true, matches: true });
  });

  it("faces are uniform", () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 60000; n++)
      counts[
        dieFromDigest(
          createHmac("sha256", "seed")
            .update(fairMessage(["a", "b"], n))
            .digest(),
        ) - 1
      ]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
  });
});
