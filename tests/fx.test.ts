import { describe, expect, it } from "vitest";
import { initialBoard } from "@/lib/engine/board";
import { effectsFor, longestBlock, type FxContext } from "@/lib/client/fx";
import { opponentAnimation } from "@/lib/client/replay";
import { boardFrom } from "./helpers";

const ctx = (over: Partial<FxContext> = {}): FxContext => ({
  yourSeats: [0],
  names: ["Ann", "Bob"],
  targetPoints: 5,
  score: [0, 0],
  board: null,
  announcedBlock: [0, 0],
  ...over,
});

describe("game effects", () => {
  it("gives 3-3 to 5-5 the big moment, 6-6 the biggest, and 1-1/2-2 a chip", () => {
    const tier = (v: number) => (effectsFor("DICE_ROLLED", { seat: 0, dice: [v, v] }, ctx(), false)[0] as { tier: string }).tier;
    expect([1, 2, 3, 4, 5, 6].map(tier)).toEqual(["chip", "chip", "big", "big", "big", "huge"]);
    expect(effectsFor("DICE_ROLLED", { seat: 0, dice: [4, 4] }, ctx(), false)[0]).toMatchObject({ label: "Quad fours", sub: "4-4 · 16 pips", mine: true });
    expect(effectsFor("DICE_ROLLED", { seat: 0, dice: [3, 5] }, ctx(), false)).toEqual([]);
  });

  it("shows the opponent's big doubles smaller to a player, but in full to spectators", () => {
    expect(effectsFor("DICE_ROLLED", { seat: 1, dice: [6, 6] }, ctx(), false)[0]).toMatchObject({ tier: "chip", mine: false });
    expect(effectsFor("DICE_ROLLED", { seat: 1, dice: [6, 6] }, ctx({ yourSeats: [] }), false)[0]).toMatchObject({ tier: "huge" });
  });

  it("announces hits, cube moments, match point and Crawford", () => {
    expect(effectsFor("TURN_COMMITTED", { seat: 1, moves: [{ from: 13, to: 7, hit: true }] }, ctx(), false)).toEqual([
      { kind: "hit", mine: false, seat: 1, spots: [7] },
    ]);
    expect(effectsFor("CUBE_OFFERED", { from: 1, proposed: 2 }, ctx(), false)).toEqual([{ kind: "cube-offer", value: 2, toYou: true }]);
    expect(effectsFor("OPENING_ROLL_COMMITTED", { crawford: false }, ctx({ score: [4, 2] }), false)[0]).toMatchObject({ text: "Match point · Ann" });
    expect(effectsFor("OPENING_ROLL_COMMITTED", { crawford: false }, ctx({ score: [4, 4] }), false)[0]).toMatchObject({ tone: "red" });
    expect(effectsFor("OPENING_ROLL_COMMITTED", { crawford: true }, ctx({ score: [4, 2] }), false)[0]).toMatchObject({ text: "Crawford game · no doubling" });
  });

  it("detects a full prime once per game, only for the latest turn", () => {
    const prime = boardFrom({ white: { 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 24: 3 }, black: { 24: 15 } });
    expect(longestBlock(prime, 0)).toBe(6);
    expect(longestBlock(initialBoard(), 0)).toBe(1);
    const c = ctx({ board: prime });
    const turn = { seat: 0, moves: [{ from: 13, to: 9 }] };
    expect(effectsFor("TURN_COMMITTED", turn, c, false)).toEqual([]);
    expect(effectsFor("TURN_COMMITTED", turn, c, true)[0]).toMatchObject({ kind: "banner", tone: "gold" });
    expect(effectsFor("TURN_COMMITTED", turn, c, true)).toEqual([]); // already announced
  });

  it("celebrates match wins from each viewer's side", () => {
    expect(effectsFor("MATCH_COMPLETED", { winner: 0 }, ctx(), false)[0]).toMatchObject({ mine: true });
    expect(effectsFor("MATCH_COMPLETED", { winner: 1 }, ctx(), false)[0]).toMatchObject({ mine: false, name: "Bob" });
    expect(effectsFor("MATCH_COMPLETED", { winner: 1 }, ctx({ yourSeats: [] }), false)[0]).toMatchObject({ mine: null });
  });
});

describe("opponent move animation", () => {
  const game = (turnNumber: number, seat: 0 | 1, moves: { from: number; to: number; die: number }[], forced = false) => ({
    gameNumber: 2,
    turnNumber,
    lastTurn: { seat, moves, forced },
  });
  const blackMove = [{ from: 13, to: 7, die: 6 }];

  it("plays a new opponent turn once, never on first load and never our own", () => {
    expect(opponentAnimation(null, game(5, 1, blackMove), [0]).anim).toBeUndefined();
    const r = opponentAnimation("2:4:0", game(5, 1, blackMove), [0]);
    expect(r.anim?.moves).toEqual([{ from: 13, to: 7, die: 6, seat: 1 }]);
    expect(opponentAnimation(r.key, game(5, 1, blackMove), [0]).anim).toBeUndefined(); // same turn: keep, don't restart
    expect(opponentAnimation("2:5:1", game(6, 0, [{ from: 6, to: 1, die: 5 }]), [0]).anim).toBeNull(); // our own turn
  });

  it("a forced pass (closed out) stops the previous animation instead of replaying it", () => {
    const afterMove = opponentAnimation("2:4:0", game(5, 1, blackMove), [0]);
    expect(afterMove.anim).not.toBeNull();
    // White hits Black, then Black is closed out and passes: nothing of Black's old move may play.
    const afterWhite = opponentAnimation(afterMove.key, game(6, 0, [{ from: 8, to: 3, die: 5 }]), [0]);
    expect(afterWhite.anim).toBeNull();
    const afterPass = opponentAnimation(afterWhite.key, game(7, 1, [], true), [0]);
    expect(afterPass.anim).toBeNull();
  });
});

describe("closed-out banner", () => {
  it("announces a forced pass by a player stuck on the bar", () => {
    const board = boardFrom({ white: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, black: { 6: 14 }, bar: [0, 1] });
    const fx = effectsFor("TURN_COMMITTED", { seat: 1, dice: [6, 5], moves: [], forced: true }, ctx({ board }), true);
    expect(fx).toEqual([{ kind: "banner", text: "Closed out! Bob rolled 6-5 and can't enter", tone: "red" }]);
  });
});
