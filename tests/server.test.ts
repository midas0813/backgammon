import { beforeEach, describe, expect, it } from "vitest";
import { read, resetDb, transact } from "@/lib/server/db";
import { createMatch, getSnapshot, joinMatch, setEnvForTests, submitAction } from "@/lib/server/matches";
import { ensureUser } from "@/lib/server/users";
import { scriptedEnv } from "./helpers";

function setup(rolls: number[]) {
  resetDb();
  setEnvForTests(scriptedEnv(rolls));
  const alice = ensureUser(undefined);
  const bob = ensureUser(undefined);
  const { matchId } = createMatch(alice.id, "private", 3);
  joinMatch(bob.id, matchId);
  return { alice, bob, matchId };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("authoritative match service", () => {
  beforeEach(() => resetDb());

  it("both sessions see identical dice and board", () => {
    const { alice, bob, matchId } = setup([6, 1]);
    const a = getSnapshot(alice.id, matchId);
    const b = getSnapshot(bob.id, matchId);
    expect(a.game!.dice).toEqual([6, 1]);
    expect(b.game!.dice).toEqual(a.game!.dice);
    expect(b.game!.board).toEqual(a.game!.board);
    expect(a.yourSeats).toEqual([0]);
    expect(b.yourSeats).toEqual([1]);
  });

  it("two concurrent turn submissions: exactly one succeeds, the other is stale", () => {
    const { alice, matchId } = setup([6, 1]);
    const v = getSnapshot(alice.id, matchId).stateVersion;
    const moves = [
      { from: 13, to: 7, die: 6 },
      { from: 8, to: 7, die: 1 },
    ];
    const first = submitAction(alice.id, matchId, { actionId: "a1", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves } });
    expect(first.version).toBe(v + 1);
    expect(
      codeOf(() => submitAction(alice.id, matchId, { actionId: "a2", expectedVersion: v, actionType: "CONFIRM_TURN", payload: { moves } })),
    ).toBe("STALE_VERSION");
  });

  it("a retried actionId returns the original response; a changed payload conflicts", () => {
    const { alice, matchId } = setup([6, 1]);
    const v = getSnapshot(alice.id, matchId).stateVersion;
    const req = {
      actionId: "same",
      expectedVersion: v,
      actionType: "CONFIRM_TURN",
      payload: {
        moves: [
          { from: 13, to: 7, die: 6 },
          { from: 8, to: 7, die: 1 },
        ],
      },
    };
    const r1 = submitAction(alice.id, matchId, req);
    const r2 = submitAction(alice.id, matchId, req);
    expect(r2).toEqual(r1);
    expect(getSnapshot(alice.id, matchId).stateVersion).toBe(v + 1);
    expect(codeOf(() => submitAction(alice.id, matchId, { ...req, payload: { moves: [] } }))).toBe("DUPLICATE_ACTION_CONFLICT");
  });

  it("rejects actions from the opponent or non-participants without changing state", () => {
    const { bob, matchId } = setup([6, 1]);
    const stranger = ensureUser(undefined);
    const v = getSnapshot(bob.id, matchId).stateVersion;
    expect(codeOf(() => submitAction(bob.id, matchId, { actionId: "b1", expectedVersion: v, actionType: "ROLL" }))).toBe("NOT_YOUR_TURN");
    expect(codeOf(() => submitAction(stranger.id, matchId, { actionId: "s1", expectedVersion: v, actionType: "ROLL" }))).toBe(
      "NOT_PARTICIPANT",
    );
    expect(getSnapshot(bob.id, matchId).stateVersion).toBe(v);
  });

  it("a refresh after a roll restores the same dice (no reroll)", () => {
    const { alice, bob, matchId } = setup([6, 1, 5, 2]);
    let v = getSnapshot(alice.id, matchId).stateVersion;
    submitAction(alice.id, matchId, {
      actionId: "t1",
      expectedVersion: v,
      actionType: "CONFIRM_TURN",
      payload: {
        moves: [
          { from: 13, to: 7, die: 6 },
          { from: 8, to: 7, die: 1 },
        ],
      },
    });
    v = getSnapshot(bob.id, matchId).stateVersion;
    submitAction(bob.id, matchId, { actionId: "r1", expectedVersion: v, actionType: "ROLL" });
    const before = getSnapshot(bob.id, matchId).game!.dice;
    const after = getSnapshot(bob.id, matchId).game!.dice;
    expect(before).toEqual([5, 2]);
    expect(after).toEqual(before);
  });

  it("a rejected action leaves the persisted store untouched (all-or-nothing transactions)", () => {
    const { alice, matchId } = setup([6, 1]);
    const before = read((db) => JSON.stringify(db.matches[matchId]));
    expect(() =>
      transact((db) => {
        db.matches[matchId].version = 999;
        throw new Error("boom");
      }),
    ).toThrow();
    expect(read((db) => JSON.stringify(db.matches[matchId]))).toBe(before);
    expect(getSnapshot(alice.id, matchId).stateVersion).not.toBe(999);
  });
});

describe("computer opponent", () => {
  it("plays complete matches against a human through the same rules engine", async () => {
    const { tickBot } = await import("@/lib/server/matches");
    const { randomEnv } = await import("./helpers");
    for (let seed = 1; seed <= 5; seed++) {
      resetDb();
      const env = randomEnv(seed);
      setEnvForTests(env);
      const human = ensureUser(undefined);
      const { matchId } = createMatch(human.id, "bot", 3);
      for (let i = 0; i < 4000; i++) {
        const s = getSnapshot(human.id, matchId);
        if (s.status === "COMPLETED") break;
        const g = s.game!;
        if (s.seatToAct === s.yourSeats[0]) {
          const req = { actionId: `h${i}`, expectedVersion: s.stateVersion };
          if (g.phase === "BEFORE_ROLL" && !g.cubeBlock[s.seatToAct] && env.rand() < 0.1) {
            submitAction(human.id, matchId, { ...req, actionType: "OFFER_DOUBLE", payload: { proposedCube: g.cubeValue * 2 } });
          } else if (g.phase === "BEFORE_ROLL") {
            submitAction(human.id, matchId, { ...req, actionType: "ROLL" });
          } else if (g.phase === "CUBE_PENDING") {
            submitAction(human.id, matchId, { ...req, actionType: "ACCEPT_DOUBLE", payload: { pendingOfferId: g.pendingOffer!.offerId } });
          } else {
            const { currentSequences } = await import("@/lib/engine/match");
            submitAction(human.id, matchId, { ...req, actionType: "CONFIRM_TURN", payload: { moves: currentSequences(g)[0] } });
          }
        } else {
          transact((db) => void (db.matches[matchId].updatedAt = 0)); // skip the human-visible pacing delay
          tickBot(matchId);
        }
      }
      const final = getSnapshot(human.id, matchId);
      expect(final.status).toBe("COMPLETED");
      expect(Math.max(...final.score)).toBeGreaterThanOrEqual(3);
    }
  });

  it("adopts the proxy-issued cookie ID so parallel first requests share one guest", () => {
    resetDb();
    const id = "11111111-2222-4333-8444-555555555555";
    expect(ensureUser(id).id).toBe(id);
    expect(ensureUser(id).id).toBe(id);
    expect(read((db) => Object.keys(db.users))).toEqual([id]);
  });
});
