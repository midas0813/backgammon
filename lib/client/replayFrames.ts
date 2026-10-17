import { applyMove, initialBoard, type Board, type Move, type Seat } from "@/lib/engine/board";

/** One step of a replay: the position after an event, with what to show and say. */
export interface Frame {
  board: Board;
  game: number;
  dice: number[] | null;
  diceSeat: Seat | null;
  cube: number;
  cubeOwner: Seat | null;
  score: [number, number];
  /** The checkers that moved into this position (animated). */
  moves: (Move & { seat: Seat })[];
  caption: string;
}

const fmtMoves = (moves: Move[]) => moves.map((m) => `${m.from === 25 ? "bar" : m.from}/${m.to === 0 ? "off" : m.to}`).join(" ");

/** Rebuild every position of a match from its event log (the server's committed history). */
export function framesFromEvents(events: { type: string; payload: Record<string, unknown> }[], names: [string, string]): Frame[] {
  const frames: Frame[] = [];
  let board = initialBoard();
  let game = 0;
  let cube = 1;
  let cubeOwner: Seat | null = null;
  let score: [number, number] = [0, 0];
  const push = (f: Partial<Frame> & { caption: string }) =>
    frames.push({ board, game, dice: null, diceSeat: null, cube, cubeOwner, score: [score[0], score[1]], moves: [], ...f });
  for (const e of events) {
    const p = e.payload;
    switch (e.type) {
      case "OPENING_ROLL_COMMITTED": {
        board = initialBoard();
        game = Number(p.gameNumber);
        cube = 1;
        cubeOwner = null;
        const rolls = p.openingRolls as [number, number][];
        const [w, b] = rolls[rolls.length - 1];
        push({ dice: [w, b], diceSeat: Number(p.firstSeat) as Seat, caption: `Game ${game}: opening roll ${w}-${b}, ${names[Number(p.firstSeat)]} starts` });
        break;
      }
      case "DICE_ROLLED":
        push({ dice: p.dice as number[], diceSeat: Number(p.seat) as Seat, caption: `${names[Number(p.seat)]} rolls ${(p.dice as number[]).join("-")}` });
        break;
      case "TURN_COMMITTED": {
        const seat = Number(p.seat) as Seat;
        const moves = (p.moves as Move[]) ?? [];
        for (const m of moves) board = applyMove(board, seat, m);
        push({
          dice: p.dice as number[],
          diceSeat: seat,
          moves: moves.map((m) => ({ ...m, seat })),
          caption: moves.length ? `${names[seat]} plays ${fmtMoves(moves)}` : `${names[seat]} can't move`,
        });
        break;
      }
      case "CUBE_OFFERED":
        push({ caption: `${names[Number(p.from)]} doubles to ${p.proposed}` });
        break;
      case "CUBE_ACCEPTED":
        cube = Number(p.cube);
        cubeOwner = Number(p.owner) as Seat;
        push({ caption: `${names[Number(p.owner)]} takes · cube ${cube}` });
        break;
      case "CUBE_PASSED":
        push({ caption: "Double declined" });
        break;
      case "GAME_COMPLETED":
        score = (p.scoreAfter as [number, number]) ?? score;
        push({
          caption: `${names[Number(p.winner)]} wins game ${p.gameNumber} (${p.kind}, ${p.points} point${Number(p.points) === 1 ? "" : "s"}) · ${score[0]}–${score[1]}`,
        });
        break;
      case "MATCH_COMPLETED":
        push({ caption: `${names[Number(p.winner)]} wins the match${p.reason && p.reason !== "points" ? ` (${p.reason})` : ""}` });
        break;
    }
  }
  return frames;
}
