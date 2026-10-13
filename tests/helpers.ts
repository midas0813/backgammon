import { absIndex, type Board, type Seat } from "@/lib/engine/board";
import type { Env } from "@/lib/engine/match";
import { expect } from "vitest";

/**
 * Build a board from player-relative placements. Checkers not placed (and not on bar) are put in `off`
 * so the 15-checker invariant always holds.
 */
export function boardFrom(spec: {
  white?: Record<number, number>;
  black?: Record<number, number>;
  bar?: [number, number];
  off?: [number, number];
}): Board {
  const board: Board = { points: new Array(24).fill(0), bar: spec.bar ?? [0, 0], off: [0, 0] };
  const place = (seat: Seat, placements: Record<number, number> = {}) => {
    let placed = board.bar[seat];
    for (const [rel, n] of Object.entries(placements)) {
      board.points[absIndex(seat, Number(rel))] += seat === 0 ? n : -n;
      placed += n;
    }
    board.off[seat] = spec.off ? spec.off[seat] : 15 - placed;
  };
  place(0, spec.white);
  place(1, spec.black);
  return board;
}

/** Deterministic dice for isolated tests only — production dice are server-random. */
export function scriptedEnv(rolls: number[]): Env {
  const queue = rolls.slice();
  let id = 0;
  return {
    roll: () => {
      const v = queue.shift();
      if (v === undefined) throw new Error("Scripted dice exhausted");
      return v;
    },
    newId: () => `offer-${++id}`,
  };
}

export function randomEnv(seed: number): Env & { rand: () => number } {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  let id = 0;
  return { roll: () => 1 + Math.floor(next() * 6), newId: () => `offer-${++id}`, rand: next };
}

export function expectCode(fn: () => unknown, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected error ${code}`).toBeDefined();
  expect((caught as { code?: string }).code).toBe(code);
}
