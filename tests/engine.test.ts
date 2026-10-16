import { describe, expect, it } from "vitest";
import {
  BAR,
  OFF,
  applyMove,
  assertInvariants,
  classifyOutcome,
  diceUses,
  initialBoard,
  legalSequences,
  matchSequence,
  nextMoves,
  pipCount,
  tryMove,
} from "@/lib/engine/board";
import { applyAction, cubeBlockReason, currentSequences, newMatch, startMatch, type MatchState } from "@/lib/engine/match";
import { boardFrom, expectCode, randomEnv, scriptedEnv } from "./helpers";

describe("board setup", () => {
  it("places 15 checkers each with 167 pips", () => {
    const b = initialBoard();
    assertInvariants(b);
    expect(pipCount(b, 0)).toBe(167);
    expect(pipCount(b, 1)).toBe(167);
  });
});

describe("opening roll", () => {
  it("rerolls a 3/3 tie, then the 5 roller starts using 2 and 5", () => {
    const m = newMatch(3);
    startMatch(m, scriptedEnv([3, 3, 2, 5]));
    expect(m.game!.openingRolls).toEqual([
      [3, 3],
      [2, 5],
    ]);
    expect(m.game!.turn).toBe(1);
    expect(m.game!.dice).toEqual([2, 5]);
    expect(m.game!.phase).toBe("ROLLED");
  });
});

describe("legal turn enumeration", () => {
  it("doubles 4/4 require four uses", () => {
    const seqs = legalSequences(initialBoard(), 0, diceUses([4, 4]));
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs.every((s) => s.length === 4)).toBe(true);
  });

  it("requires the higher die when only one of 2 or 6 can be played", () => {
    // White: one checker on 10. Black holds White's 2-point, so neither order plays both dice.
    const b = boardFrom({ white: { 10: 1 }, black: { 23: 2 } });
    const seqs = legalSequences(b, 0, [2, 6]);
    expect(seqs).toEqual([[{ from: 10, to: 4, die: 6, hit: false }]]);
  });

  it("rejects a sequence that abandons a usable die", () => {
    const seqs = legalSequences(initialBoard(), 0, [6, 1]);
    expect(matchSequence(seqs, [{ from: 24, to: 18, die: 6 }])).toBeNull();
    expect(
      matchSequence(seqs, [
        { from: 13, to: 7, die: 6 },
        { from: 8, to: 7, die: 1 },
      ]),
    ).not.toBeNull();
  });

  it("blocks points with two opponents and hits a single opponent", () => {
    const blocked = boardFrom({ white: { 24: 1 }, black: { 7: 2 } }); // White 18 = Black 7
    expect(tryMove(blocked, 0, 24, 6)).toBeNull();
    const blot = boardFrom({ white: { 24: 1 }, black: { 7: 1 } });
    const m = tryMove(blot, 0, 24, 6)!;
    expect(m.hit).toBe(true);
    const after = applyMove(blot, 0, m);
    expect(after.bar[1]).toBe(1);
    assertInvariants(after);
  });

  it("forces bar entry before any other move; entry point is 25 − die", () => {
    const b = boardFrom({ white: { 13: 5 }, black: {}, bar: [1, 0] });
    const seqs = legalSequences(b, 0, [3, 5]);
    expect(seqs.every((s) => s[0].from === BAR)).toBe(true);
    expect(seqs.some((s) => s[0].to === 22 && s[0].die === 3)).toBe(true);
  });

  it("closed board: no checker move, but a before-roll cube offer remains legal", () => {
    const m = newMatch(5);
    startMatch(m, scriptedEnv([6, 1]));
    const g = m.game!;
    // White on the bar against Black's closed home board (Black 1..6 = White 19..24).
    g.board = boardFrom({ white: { 6: 5 }, black: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, bar: [1, 0] });
    g.phase = "BEFORE_ROLL";
    g.turn = 0;
    g.dice = null;
    expect(cubeBlockReason(m, 0)).toBeNull();
    applyAction(m, 0, { actionType: "ROLL" }, scriptedEnv([4, 2]));
    // Forced pass is committed and announced automatically.
    expect(g.turn).toBe(1);
    expect(g.lastTurn).toMatchObject({ seat: 0, forced: true, moves: [] });
  });

  it("bears off by overshoot only from the highest occupied point", () => {
    const only5 = boardFrom({ white: { 5: 1 } });
    expect(tryMove(only5, 0, 5, 6)).toEqual({ from: 5, to: OFF, die: 6 });
    const with6 = boardFrom({ white: { 6: 1, 5: 1 } });
    expect(tryMove(with6, 0, 5, 6)).toBeNull();
    expect(tryMove(with6, 0, 6, 6)).toEqual({ from: 6, to: OFF, die: 6 });
  });

  it("a hit during bear-off interrupts bearing off until re-entry", () => {
    const b = boardFrom({ white: { 6: 3, 2: 2 }, bar: [1, 0] });
    expect(tryMove(b, 0, 6, 6)).toBeNull();
    expect(nextMoves(legalSequences(b, 0, [6, 5]), []).every((m) => m.from === BAR)).toBe(true);
  });
});

describe("outcomes and cube", () => {
  it("scores single / gammon / backgammon at cube 8 as 8 / 16 / 24", () => {
    const single = boardFrom({ white: {}, black: { 10: 1 } });
    const gammon = boardFrom({ white: {}, black: { 10: 15 }, off: [15, 0] });
    const bg = boardFrom({ white: {}, black: { 10: 14, 20: 1 }, off: [15, 0] });
    expect(classifyOutcome(single, 0).multiplier * 8).toBe(8);
    expect(classifyOutcome(gammon, 0).multiplier * 8).toBe(16);
    expect(classifyOutcome(bg, 0).multiplier * 8).toBe(24);
  });

  function cubeMatch(cube: number, owner: 0 | 1 | null, target = 1001): MatchState {
    const m = newMatch(target);
    startMatch(m, scriptedEnv([2, 1]));
    const g = m.game!;
    g.phase = "BEFORE_ROLL";
    g.dice = null;
    g.turn = 0;
    g.cubeValue = cube;
    g.cubeOwner = owner;
    return m;
  }

  it("offer 64→128 accepted: cube 128, owned by recipient, no offer to 256", () => {
    const m = cubeMatch(64, 0);
    const env = scriptedEnv([]);
    applyAction(m, 0, { actionType: "OFFER_DOUBLE", payload: { proposedCube: 128 } }, env);
    applyAction(m, 1, { actionType: "ACCEPT_DOUBLE", payload: { pendingOfferId: "offer-1" } }, env);
    expect(m.game!.cubeValue).toBe(128);
    expect(m.game!.cubeOwner).toBe(1);
    expect(m.game!.turn).toBe(0);
    expect(cubeBlockReason(m, 1)).toBe("CUBE_CAPPED");
  });

  it("offer 64→128 passed: awards 64, not 128", () => {
    const m = cubeMatch(64, 0);
    const env = scriptedEnv([4, 2]);
    applyAction(m, 0, { actionType: "OFFER_DOUBLE", payload: { proposedCube: 128 } }, env);
    applyAction(m, 1, { actionType: "PASS_DOUBLE", payload: { pendingOfferId: "offer-1" } }, env);
    expect(m.score).toEqual([64, 0]);
    expect(m.results[0]).toMatchObject({ kind: "pass", points: 64 });
  });

  it("rejects doubling after rolling or without ownership, leaving state unchanged", () => {
    const m = cubeMatch(2, 1);
    const before = JSON.stringify(m);
    expectCode(() => applyAction(m, 0, { actionType: "OFFER_DOUBLE", payload: { proposedCube: 4 } }, scriptedEnv([])), "CUBE_NOT_OWNED");
    expect(JSON.stringify(m)).toBe(before);
    const m2 = cubeMatch(1, null);
    applyAction(m2, 0, { actionType: "ROLL" }, scriptedEnv([3, 1]));
    expectCode(() => applyAction(m2, 0, { actionType: "OFFER_DOUBLE", payload: { proposedCube: 2 } }, scriptedEnv([])), "WRONG_PHASE");
  });

  it("Crawford game disables the cube once, then it returns", () => {
    const m = newMatch(3);
    startMatch(m, scriptedEnv([2, 1]));
    m.game!.phase = "BEFORE_ROLL";
    m.game!.dice = null;
    // Black owns a 2-cube and redoubles; White passes, putting Black at 2 (one-away in a 3-point match).
    m.game!.cubeValue = 2;
    m.game!.cubeOwner = 1;
    m.game!.turn = 1;
    applyAction(m, 1, { actionType: "OFFER_DOUBLE", payload: { proposedCube: 4 } }, scriptedEnv([]));
    applyAction(m, 0, { actionType: "PASS_DOUBLE", payload: { pendingOfferId: "offer-1" } }, scriptedEnv([5, 3]));
    expect(m.score).toEqual([0, 2]);
    expect(m.game!.crawford).toBe(true);
    expect(cubeBlockReason(m, 0)).toBe("CRAWFORD_CUBE_DISABLED");

    // Finish the Crawford game with a White single win.
    m.game!.board = boardFrom({ white: { 1: 1 }, black: { 10: 1 } });
    m.game!.turn = 0;
    m.game!.phase = "ROLLED";
    m.game!.dice = [6, 5];
    applyAction(m, 0, { actionType: "CONFIRM_TURN", payload: { moves: [{ from: 1, to: 0, die: 6 }] } }, scriptedEnv([4, 1]));
    expect(m.score).toEqual([1, 2]);
    expect(m.game!.crawford).toBe(false);
    // Post-Crawford: White (2-away) may double; Black (1-away) has a dead cube.
    expect(cubeBlockReason(m, 0)).toBeNull();
    expect(cubeBlockReason(m, 1)).toBe("CUBE_DEAD");
  });
});

describe("random full games", () => {
  it("always terminate with conserved checkers and a correct score", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const env = randomEnv(seed);
      const m = newMatch(5);
      startMatch(m, env);
      let guard = 0;
      while (m.status === "ACTIVE" && guard++ < 5000) {
        const g = m.game!;
        if (g.phase === "BEFORE_ROLL") {
          if (cubeBlockReason(m, g.turn) === null && env.rand() < 0.05) {
            applyAction(m, g.turn, { actionType: "OFFER_DOUBLE", payload: { proposedCube: g.cubeValue * 2 } }, env);
          } else {
            applyAction(m, g.turn, { actionType: "ROLL" }, env);
          }
        } else if (g.phase === "CUBE_PENDING") {
          const recipient = g.pendingOffer!.from === 0 ? 1 : 0;
          const type = env.rand() < 0.7 ? "ACCEPT_DOUBLE" : "PASS_DOUBLE";
          applyAction(m, recipient, { actionType: type, payload: { pendingOfferId: g.pendingOffer!.offerId } }, env);
        } else {
          const seqs = currentSequences(g);
          const seq = seqs[Math.floor(env.rand() * seqs.length)];
          applyAction(m, g.turn, { actionType: "CONFIRM_TURN", payload: { moves: seq } }, env);
        }
        if (m.game) assertInvariants(m.game.board);
      }
      expect(m.status).toBe("COMPLETED");
      expect(m.score[m.winner!]).toBeGreaterThanOrEqual(5);
      const total = m.results.reduce((s, r) => s + r.points, 0);
      expect(total).toBe(m.score[0] + m.score[1]);
    }
  });
});
