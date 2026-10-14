import { absIndex, type Board, type Seat } from "@/lib/engine/board";

/**
 * Which moments get which effect. Pure: maps committed server events (the same ones players and
 * spectators receive) to effects, so both see exactly the same show. Tune the tables here, not in
 * the components.
 */
export type Effect =
  | { kind: "doubles"; value: number; tier: "chip" | "big" | "huge"; label: string; sub: string; mine: boolean }
  | { kind: "hit"; mine: boolean }
  | { kind: "cube-offer"; value: number; toYou: boolean }
  | { kind: "cube-take"; value: number }
  | { kind: "cube-drop" }
  | { kind: "banner"; text: string; tone: "gold" | "mint" | "red" | "blue" }
  | { kind: "your-turn" }
  | { kind: "game-win"; label: string; mine: boolean | null }
  | { kind: "match-win"; name: string; mine: boolean | null };

/** Doubles: pips moved = value × 4. Bigger rolls get bigger moments; 6-6 is the biggest. */
export const DOUBLES: Record<number, { tier: "chip" | "big" | "huge"; label: string }> = {
  1: { tier: "chip", label: "Snake eyes" },
  2: { tier: "chip", label: "Double deuces" },
  3: { tier: "big", label: "Double threes" },
  4: { tier: "big", label: "Quad fours" },
  5: { tier: "big", label: "Double fives" },
  6: { tier: "huge", label: "Boxcars" },
};

export interface FxContext {
  /** Seats the viewer plays (empty for spectators, both for pass & play). */
  yourSeats: Seat[];
  names: [string, string];
  targetPoints: number;
  score: [number, number];
  /** Current board, used for position-based moments after the latest turn. */
  board: Board | null;
  /** Longest block already announced per seat this game (mutated). */
  announcedBlock: [number, number];
}

const KIND_LABEL: Record<string, string> = {
  single: "Single game",
  gammon: "GAMMON ×2",
  backgammon: "BACKGAMMON ×3",
  pass: "Double declined",
  forfeit: "Forfeit",
};

/** Longest run of consecutive points holding two or more of `seat`'s checkers (6 = a full prime). */
export function longestBlock(board: Board, seat: Seat): number {
  let best = 0,
    run = 0;
  for (let rel = 1; rel <= 24; rel++) {
    const v = board.points[absIndex(seat, rel)];
    const mine = seat === 0 ? v : -v;
    run = mine >= 2 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Effects for one event. `latest` marks the newest TURN_COMMITTED in this batch: only then does the
 * current board describe the position right after it.
 */
export function effectsFor(type: string, p: Record<string, unknown>, ctx: FxContext, latest: boolean): Effect[] {
  const solo = ctx.yourSeats.length === 1 ? ctx.yourSeats[0] : null;
  const isMine = (seat: unknown) => (ctx.yourSeats.length === 2 ? true : solo !== null && Number(seat) === solo);
  const out: Effect[] = [];
  switch (type) {
    case "DICE_ROLLED": {
      const [a, b] = p.dice as number[];
      if (a === b) {
        const d = DOUBLES[a];
        const mine = isMine(p.seat);
        // The opponent's big roll is shown smaller to the player; spectators get the full show.
        const tier = !mine && solo !== null && d.tier !== "chip" ? "chip" : d.tier;
        out.push({ kind: "doubles", value: a, tier, label: d.label, sub: `${a}-${a} · ${a * 4} pips`, mine });
      }
      break;
    }
    case "TURN_COMMITTED": {
      const seat = Number(p.seat) as Seat;
      const moves = (p.moves as { to: number; hit?: boolean }[]) ?? [];
      if (moves.some((m) => m.hit)) out.push({ kind: "hit", mine: isMine(seat) });
      if (latest && ctx.board) {
        const block = longestBlock(ctx.board, seat);
        if (block >= 6 && ctx.announcedBlock[seat] < 6) {
          out.push({ kind: "banner", text: `PRIME! ${ctx.names[seat]} walls off six points`, tone: "gold" });
        } else if (block === 5 && ctx.announcedBlock[seat] < 5) {
          out.push({ kind: "banner", text: `Blockade · five points in a row`, tone: "blue" });
        }
        ctx.announcedBlock[seat] = Math.max(ctx.announcedBlock[seat], block);
        const borne = moves.filter((m) => m.to === 0).length;
        if (borne > 0 && ctx.board.off[seat] === borne) out.push({ kind: "banner", text: `${ctx.names[seat]} starts bearing off`, tone: "mint" });
      }
      break;
    }
    case "CUBE_OFFERED":
      out.push({ kind: "cube-offer", value: Number(p.proposed), toYou: solo !== null && Number(p.from) !== solo });
      break;
    case "CUBE_ACCEPTED":
      out.push({ kind: "cube-take", value: Number(p.cube) });
      break;
    case "CUBE_PASSED":
      out.push({ kind: "cube-drop" });
      break;
    case "OPENING_ROLL_COMMITTED": {
      ctx.announcedBlock[0] = 0;
      ctx.announcedBlock[1] = 0;
      const mp = ctx.score.map((s) => s === ctx.targetPoints - 1);
      if (p.crawford) out.push({ kind: "banner", text: "Crawford game · no doubling", tone: "blue" });
      else if (mp[0] && mp[1]) out.push({ kind: "banner", text: "Double match point · next game wins", tone: "red" });
      else if (mp[0] || mp[1]) out.push({ kind: "banner", text: `Match point · ${ctx.names[mp[0] ? 0 : 1]}`, tone: "red" });
      break;
    }
    case "GAME_COMPLETED": {
      const kind = String(p.kind);
      if (kind === "gammon" || kind === "backgammon" || kind === "pass") {
        out.push({ kind: "game-win", label: KIND_LABEL[kind], mine: solo === null ? null : Number(p.winner) === solo });
      }
      break;
    }
    case "MATCH_COMPLETED":
      out.push({ kind: "match-win", name: ctx.names[Number(p.winner)], mine: solo === null ? null : Number(p.winner) === solo });
      break;
  }
  return out;
}
