import { describe, expect, it } from "vitest";
import { currentSequences } from "@/lib/engine/match";
import { createMatch, forceBotDue, getSnapshot, joinMatch, leaveMatch, setEnvForTests, submitAction, tickBot } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureUser } from "@/lib/server/users";
import { randomEnv, scriptedEnv } from "./helpers";

async function setup(rolls: number[]) {
  setEnvForTests(scriptedEnv(rolls));
  const alice = await ensureUser(undefined);
  const bob = await ensureUser(undefined);
  const { matchId } = await createMatch(alice.id, "private", 3);
  await joinMatch(bob.id, matchId);
  return { alice, bob, matchId };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

const OPENING_61 = [
  { from: 13, to: 7, die: 6 },
  { from: 8, to: 7, die: 1 },
];

describe("authoritative match service", () => {
  it("both sessions see identical dice and board", async () => {
    const { alice, bob, matchId } = await setup([6, 1]);
    const a = await getSnapshot(alice.id, matchId);
    const b = await getSnapshot(bob.id, matchId);
    expect(a.game!.dice).toEqual([6, 1]);
    expect(b.game!.dice).toEqual(a.game!.dice);
    expect(b.game!.board).toEqual(a.game!.board);
    expect(a.yourSeats).toEqual([0]);
    expect(b.yourSeats).toEqual([1]);
  });

  it("two concurrent turn submissions: exactly one succeeds, the other is stale", async () => {
    const { alice, matchId } = await setup([6, 1]);
    const v = (await getSnapshot(alice.id, matchId)).stateVersion;
    const results = await Promise.allSettled([
      submitAction(alice.id, matchId, { actionId: "a1", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves: OPENING_61 } }),
      submitAction(alice.id, matchId, { actionId: "a2", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves: OPENING_61 } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("STALE_VERSION");
    expect((await getSnapshot(alice.id, matchId)).stateVersion).toBe(v + 1);
  });

  it("a retried actionId returns the original response; a changed payload conflicts", async () => {
    const { alice, matchId } = await setup([6, 1]);
    const v = (await getSnapshot(alice.id, matchId)).stateVersion;
    const req = { actionId: "same", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves: OPENING_61 } };
    const r1 = await submitAction(alice.id, matchId, req);
    const r2 = await submitAction(alice.id, matchId, req);
    expect(r2).toEqual(r1);
    expect((await getSnapshot(alice.id, matchId)).stateVersion).toBe(v + 1);
    expect(await codeOf(submitAction(alice.id, matchId, { ...req, payload: { moves: [] } }))).toBe("DUPLICATE_ACTION_CONFLICT");
  });

  it("rejects actions from the opponent or non-participants without changing state", async () => {
    const { bob, matchId } = await setup([6, 1]);
    const stranger = await ensureUser(undefined);
    const v = (await getSnapshot(bob.id, matchId)).stateVersion;
    expect(await codeOf(submitAction(bob.id, matchId, { actionId: "b1", expectedVersion: v, actionType: "ROLL" }))).toBe("NOT_YOUR_TURN");
    expect(await codeOf(submitAction(stranger.id, matchId, { actionId: "s1", expectedVersion: v, actionType: "ROLL" }))).toBe("NOT_PARTICIPANT");
    expect((await getSnapshot(bob.id, matchId)).stateVersion).toBe(v);
  });

  it("a refresh after a roll restores the same dice (no reroll)", async () => {
    const { alice, bob, matchId } = await setup([6, 1, 5, 2]);
    let v = (await getSnapshot(alice.id, matchId)).stateVersion;
    await submitAction(alice.id, matchId, { actionId: "t1", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves: OPENING_61 } });
    v = (await getSnapshot(bob.id, matchId)).stateVersion;
    await submitAction(bob.id, matchId, { actionId: "r1", expectedVersion: v, actionType: "ROLL" });
    const before = (await getSnapshot(bob.id, matchId)).game!.dice;
    const after = (await getSnapshot(bob.id, matchId)).game!.dice;
    expect(before).toEqual([5, 2]);
    expect(after).toEqual(before);
  });

  it("a transaction that throws leaves the store untouched", async () => {
    const { alice, matchId } = await setup([6, 1]);
    const before = (await getSnapshot(alice.id, matchId)).stateVersion;
    await expect(
      tx(async (t) => {
        const rec = (await t.matches.get(matchId, { lock: true }))!;
        rec.version = 999;
        await t.matches.put(rec);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await getSnapshot(alice.id, matchId)).stateVersion).toBe(before);
  });

  it("one game at a time: another table, join or computer game is refused until the first ends", async () => {
    setEnvForTests(randomEnv(7));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const c = await ensureUser(undefined);
    const table = await createMatch(a.id, "quick", 5);
    const err = await createMatch(a.id, "bot", 3).catch((e) => e);
    expect(err.code).toBe("ALREADY_IN_GAME");
    expect(err.extra.current).toMatchObject({ matchId: table.matchId, status: "WAITING", host: true });

    const bot = await createMatch(b.id, "bot", 3);
    expect(await codeOf(joinMatch(b.id, table.matchId))).toBe("ALREADY_IN_GAME");
    // Two tabs at once: exactly one new game.
    const both = await Promise.allSettled([createMatch(c.id, "bot", 1), createMatch(c.id, "local", 1)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // Ending the computer game frees the player, with no result recorded.
    expect(await leaveMatch(b.id, bot.matchId)).toMatchObject({ status: "CANCELLED" });
    await joinMatch(b.id, table.matchId);
    expect((await getSnapshot(a.id, table.matchId)).status).toBe("ACTIVE");
    // Leaving an online match forfeits it.
    expect(await leaveMatch(a.id, table.matchId)).toMatchObject({ status: "COMPLETED" });
    expect((await getSnapshot(b.id, table.matchId)).winner).toBe(1);
    await createMatch(a.id, "bot", 1);
  });
});

describe("computer opponent", () => {
  it("plays complete matches against a human through the same rules engine", async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const env = randomEnv(seed);
      setEnvForTests(env);
      const human = await ensureUser(undefined);
      const { matchId } = await createMatch(human.id, "bot", 3);
      for (let i = 0; i < 4000; i++) {
        const s = await getSnapshot(human.id, matchId);
        if (s.status === "COMPLETED") break;
        const g = s.game!;
        if (s.seatToAct === s.yourSeats[0]) {
          const req = { actionId: `h${seed}-${i}`, expectedVersion: s.stateVersion };
          if (g.phase === "BEFORE_ROLL" && !g.cubeBlock[s.seatToAct] && env.rand() < 0.1) {
            await submitAction(human.id, matchId, { ...req, actionType: "OFFER_DOUBLE", payload: { proposedCube: g.cubeValue * 2 } });
          } else if (g.phase === "BEFORE_ROLL") {
            await submitAction(human.id, matchId, { ...req, actionType: "ROLL" });
          } else if (g.phase === "CUBE_PENDING") {
            await submitAction(human.id, matchId, { ...req, actionType: "ACCEPT_DOUBLE", payload: { pendingOfferId: g.pendingOffer!.offerId } });
          } else {
            await submitAction(human.id, matchId, { ...req, actionType: "CONFIRM_TURN", payload: { moves: currentSequences(g)[0] } });
          }
        } else {
          await forceBotDue(matchId); // skip the human-visible pacing delay
          await tickBot(matchId);
        }
      }
      const final = await getSnapshot(human.id, matchId);
      expect(final.status).toBe("COMPLETED");
      expect(Math.max(...final.score)).toBeGreaterThanOrEqual(3);
    }
  });

  it("maps one proxy-issued session token to one guest, even across concurrent first requests", async () => {
    const token = "11111111-2222-4333-8444-555555555555";
    const [a, b] = await Promise.all([ensureUser(token), ensureUser(token)]);
    const c = await ensureUser(token);
    expect(c.id).toBe(a.id);
    expect(b.id).toBe(a.id);
    expect(await tx((t) => t.users.count())).toBe(1);
  });
});
