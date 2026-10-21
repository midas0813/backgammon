import { describe, expect, it } from "vitest";
import { chooseChessMove } from "@/lib/chess/bot";
import { replay } from "@/lib/chess/rules";
import { nextDecision, newChessClock } from "@/lib/server/clock";
import { createTable, lobby, publicTables } from "@/lib/server/lobby";
import { createMatch, forceBotDue, getSnapshot, joinMatch, leaveMatch, submitAction, tickBot } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureAccount } from "./helpers";

let n = 0;
async function act(userId: string, matchId: string, actionType: string, payload?: Record<string, unknown>) {
  const snap = await getSnapshot(userId, matchId);
  return submitAction(userId, matchId, { actionId: `chess-${++n}`, expectedVersion: snap.stateVersion, actionType, payload });
}

/** A rated public chess table between two accounts; the host plays White. */
async function chessGame(tc = "5+0") {
  const white = await ensureAccount();
  const black = await ensureAccount();
  const { matchId } = await createTable(white.id, { game: "chess", timeControl: tc, color: "white" });
  await joinMatch(black.id, matchId);
  return { matchId, white, black };
}

async function play(matchId: string, white: string, black: string, moves: string[]) {
  for (let i = 0; i < moves.length; i++) await act(i % 2 === 0 ? white : black, matchId, "MOVE", { uci: moves[i] });
}

describe("chess", () => {
  it("plays to checkmate, records the result and moves both ratings", async () => {
    const { matchId, white, black } = await chessGame();
    // Fool's mate: Black mates on move 2.
    await play(matchId, white.id, black.id, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    const snap = await getSnapshot(white.id, matchId);
    expect(snap.gameType).toBe("chess");
    expect(snap.status).toBe("COMPLETED");
    expect(snap.winner).toBe(1);
    expect(snap.chess).toMatchObject({ result: { winner: 1, reason: "checkmate" }, inCheck: true });
    expect(snap.chess!.san).toEqual(["f3", "e5", "g4", "Qh4#"]);
    const stats = await tx((t) => t.gameStats.getMany([white.id, black.id], "chess"));
    expect(stats[black.id].rating).toBeGreaterThan(1500);
    expect(stats[white.id].rating).toBeLessThan(1500);
    expect(stats[black.id].xp).toBeGreaterThan(stats[white.id].xp);
    // Backgammon numbers are untouched.
    const bg = await tx((t) => t.gameStats.getMany([black.id], "backgammon"));
    expect(bg[black.id]).toMatchObject({ rating: 1500, xp: 0 });
  });

  it("rejects illegal moves, moves out of turn and backgammon actions", async () => {
    const { matchId, white, black } = await chessGame();
    await expect(act(white.id, matchId, "MOVE", { uci: "e2e5" })).rejects.toMatchObject({ code: "INVALID_MOVE_SEQUENCE" });
    await expect(act(black.id, matchId, "MOVE", { uci: "e7e5" })).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });
    await expect(act(white.id, matchId, "ROLL")).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });

  it("draw offers: declined, cleared by the opponent's move, then agreed", async () => {
    const g = await chessGame();
    await play(g.matchId, g.white.id, g.black.id, ["e2e4", "e7e5"]);
    await act(g.white.id, g.matchId, "OFFER_DRAW");
    await act(g.black.id, g.matchId, "DECLINE_DRAW");
    expect((await getSnapshot(g.white.id, g.matchId)).chess!.drawOffer).toBeNull();
    // An offer stands through the offerer's own move and lapses when the other side moves.
    await act(g.white.id, g.matchId, "OFFER_DRAW");
    await act(g.white.id, g.matchId, "MOVE", { uci: "g1f3" });
    expect((await getSnapshot(g.white.id, g.matchId)).chess!.drawOffer).toBe(0);
    await act(g.black.id, g.matchId, "MOVE", { uci: "b8c6" });
    expect((await getSnapshot(g.white.id, g.matchId)).chess!.drawOffer).toBeNull();
    await act(g.black.id, g.matchId, "OFFER_DRAW");
    await act(g.white.id, g.matchId, "ACCEPT_DRAW");
    const snap = await getSnapshot(g.white.id, g.matchId);
    expect(snap).toMatchObject({ status: "COMPLETED", winner: null, endReason: "draw" });
    expect(snap.chess!.result).toEqual({ winner: null, reason: "agreement" });
  });

  it("resigning and leaving lose the game", async () => {
    const g = await chessGame();
    await play(g.matchId, g.white.id, g.black.id, ["d2d4", "d7d5"]);
    await act(g.black.id, g.matchId, "FORFEIT_MATCH", { confirm: true });
    expect((await getSnapshot(g.white.id, g.matchId)).chess!.result).toEqual({ winner: 0, reason: "resign" });

    const h = await chessGame();
    await leaveMatch(h.white.id, h.matchId);
    expect((await getSnapshot(h.black.id, h.matchId)).winner).toBe(1);
  });

  it("chess tables are listed under chess only", async () => {
    const host = await ensureAccount();
    const { matchId } = await createTable(host.id, { game: "chess", timeControl: "3+2" });
    const chessTables = await publicTables({ game: "chess" });
    expect(chessTables.tables.map((t) => t.matchId)).toContain(matchId);
    expect((await publicTables({ game: "backgammon" })).tables.map((t) => t.matchId)).not.toContain(matchId);
    expect((await lobby(host.id, "chess")).mine[0]).toMatchObject({ matchId, gameType: "chess" });
    await expect(createTable(host.id, { game: "chess", timeControl: "2+1" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("Fischer clock: the increment is added after each move", () => {
    const c = newChessClock("3+2", 180_000, 2_000);
    nextDecision(c, 0, 0);
    nextDecision(c, 1, 10_000); // White used 10 s, gets 2 s back
    expect(c.bankMs[0]).toBe(172_000);
    nextDecision(c, 0, 15_000);
    expect(c.bankMs[1]).toBe(177_000);
  });

  it("the computer plays legal moves and takes a free queen", async () => {
    // After 1.e4 d5 2.Qh5?? the queen on h5 hangs to ...Nf6? No: test a direct capture instead.
    const moves = ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"]; // White queen takes f7 with check
    const reply = chooseChessMove(moves, 3);
    expect(reply).toBe("e8f7"); // the king takes the undefended queen
    // Any level always answers with a legal move.
    for (const level of [1, 2, 3]) {
      const uci = chooseChessMove(["e2e4"], level);
      expect(
        replay(["e2e4"])
          .moves({ verbose: true })
          .some((m) => `${m.from}${m.to}${m.promotion ?? ""}` === uci),
      ).toBe(true);
    }
  });

  it("a game against the computer: it replies to your move", async () => {
    const me = await ensureAccount();
    const { matchId } = await createMatch(me.id, "bot", 1, { game: "chess", botLevel: 1 });
    let snap = await getSnapshot(me.id, matchId);
    if (snap.seatToAct !== 0) {
      await forceBotDue(matchId);
      await tickBot(matchId);
      snap = await getSnapshot(me.id, matchId);
    }
    expect(snap.seatToAct).toBe(0);
    const legal = replay(snap.chess!.moves).moves({ verbose: true })[0];
    await act(me.id, matchId, "MOVE", { uci: `${legal.from}${legal.to}${legal.promotion ?? ""}` });
    await forceBotDue(matchId);
    await tickBot(matchId);
    snap = await getSnapshot(me.id, matchId);
    expect(snap.chess!.moves.length % 2).toBe(snap.chess!.white === 0 ? 0 : 1);
    expect(snap.seatToAct).toBe(0);
  });
});
