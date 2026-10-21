import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminContext } from "@/lib/server/admin/auth";
import { saveTournamentSeries, tournamentAction } from "@/lib/server/admin/service";
import { userBalances } from "@/lib/server/ledger";
import { getSnapshot, leaveMatch, setEnvForTests, submitAction, sweep } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { getTournament, listTournaments, readyMatches, register, unregister } from "@/lib/server/tournaments";
import { ensureUser } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("sit & go tournaments", () => {
  it("starts when full, advances winners and crowns a champion", async () => {
    setEnvForTests(randomEnv(500));
    const { open } = await listTournaments(null);
    const quick = open.find((t) => t.kind === "sitgo" && t.game === "backgammon" && t.size === 4)!;
    const players = [];
    for (let i = 0; i < 4; i++) players.push(await ensureAccount());
    await register(players[0].id, quick.id);
    await unregister(players[0].id, quick.id);
    for (const p of players) await register(p.id, quick.id);

    let t = await getTournament(players[0].id, quick.id);
    expect(t.status).toBe("RUNNING");
    expect(t.rounds[0].every((s) => s.matchId)).toBe(true);
    // A new open table appears for the next group.
    expect((await listTournaments(null)).open.some((x) => x.size === 4 && x.game === "backgammon" && x.kind === "sitgo" && x.id !== quick.id)).toBe(true);
    // Players are called to their match until they open it.
    expect(await readyMatches(players[0].id)).toHaveLength(1);

    // Each first-round match: one player forfeits.
    for (const slot of t.rounds[0]) {
      const rec = await tx((x) => x.matches.get(slot.matchId!));
      await leaveMatch(rec!.seats[1]!, rec!.id);
    }
    t = await getTournament(players[0].id, quick.id);
    expect(t.rounds[0].every((s) => s.winner)).toBe(true);
    const final = t.rounds[1][0];
    expect(final.matchId).toBeTruthy();
    const rec = await tx((x) => x.matches.get(final.matchId!));
    await leaveMatch(rec!.seats[0]!, rec!.id);
    t = await getTournament(null, quick.id);
    expect(t.status).toBe("COMPLETED");
    expect(t.winner).toBe(rec!.names[1]);
    expect((await tx((x) => x.users.get(rec!.seats[1]!)))?.xp).toBeGreaterThanOrEqual(200);
  });

  it("guests cannot join; wallet accounts can", async () => {
    const { open } = await listTournaments(null);
    const quick = open.find((t) => t.kind === "sitgo" && t.game === "backgammon" && t.size === 4)!;
    const guest = await ensureUser(undefined);
    await expect(register(guest.id, quick.id)).rejects.toMatchObject({ code: "WALLET_REQUIRED" });
    expect((await getTournament(guest.id, quick.id)).joined).toBe(false);
    const player = await ensureAccount();
    await register(player.id, quick.id);
    expect((await getTournament(player.id, quick.id)).joined).toBe(true);
    await unregister(player.id, quick.id);
  });

  it("a round nobody turns up for goes to the better seed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setEnvForTests(randomEnv(501));
    const { open } = await listTournaments(null);
    const quick = open.find((t) => t.kind === "sitgo" && t.game === "backgammon" && t.size === 4)!;
    const players = [];
    for (let i = 0; i < 4; i++) players.push(await ensureAccount());
    for (const p of players) await register(p.id, quick.id);
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await sweep(Date.now(), true);
    const t = await getTournament(null, quick.id);
    expect(t.rounds[0].every((s) => s.winner && s.walkover)).toBe(true);
    const s = await getSnapshot(players[0].id, t.rounds[1][0].matchId!).catch(() => null);
    expect(s?.status).toBe("ACTIVE");
  });
});

/** An admin context for a real account (the audit log refers to it). */
async function admin(role: AdminContext["role"]): Promise<AdminContext> {
  const u = await ensureAccount();
  return { userId: u.id, role, wallet: u.walletAddress, name: "Admin", token: "t", sessionCreatedAt: Date.now() };
}

/** Finish every match that is being played: the second seat leaves. */
async function playOut(id: string) {
  for (let guard = 0; guard < 20; guard++) {
    const d = await tx((t) => t.tournaments.get(id));
    if (d?.status !== "RUNNING") return d;
    for (const round of d.rounds) for (const s of round) if (s.matchId && !s.winner) await leaveMatch(s.b!, s.matchId);
  }
  throw new Error("tournament did not finish");
}

describe("tournaments organised by admins", () => {
  it("only admins with the right role set up series", async () => {
    const series = [{ name: "Cup", kind: "weekly", game: "chess", weekday: 3 }];
    await expect(saveTournamentSeries(await admin("viewer"), { series })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveTournamentSeries(await admin("operator"), { series: [{ name: "x" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const r = await saveTournamentSeries(await admin("operator"), { series });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]).toMatchObject({ kind: "weekly", game: "chess", rewards: [{ xp: 600, credits: 500 }, { xp: 300 }, { xp: 150 }, { xp: 50 }] });
  });

  it("a weekly cup opens registration, starts on time with byes, and hands out its rewards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 10, 0)); // Monday
    const rewards = [
      { xp: 500, credits: 100, prize: "Gold badge" },
      { xp: 250, credits: 0, prize: "" },
      { xp: 100, credits: 0, prize: "" },
      { xp: 0, credits: 0, prize: "" },
    ];
    await saveTournamentSeries(await admin("owner"), {
      series: [
        {
          id: "wed-blitz",
          name: "Wednesday Blitz",
          kind: "weekly",
          game: "chess",
          weekday: 3,
          time: "18:00",
          size: 8,
          minPlayers: 3,
          registrationHours: 72,
          timeControl: "3+2",
          rewards,
        },
      ],
    });
    const { open } = await listTournaments(null);
    expect(open).toHaveLength(1);
    const cup = open[0];
    expect(cup).toMatchObject({ kind: "weekly", game: "chess", startsAt: "2026-11-04T18:00:00.000Z", status: "REGISTERING" });

    const players = [];
    for (let i = 0; i < 5; i++) players.push(await ensureAccount());
    for (const p of players) await register(p.id, cup.id);
    // Nothing starts before its time, even with players waiting.
    expect((await getTournament(null, cup.id)).status).toBe("REGISTERING");

    vi.setSystemTime(Date.UTC(2026, 10, 4, 18, 1));
    const t = await getTournament(null, cup.id);
    expect(t.status).toBe("RUNNING");
    expect(t.size).toBe(8);
    expect(t.rounds[0].filter((s) => s.bye)).toHaveLength(3);
    // The next week's cup is not open yet (registration opens 72 hours before).
    expect((await listTournaments(null)).open).toHaveLength(0);

    const done = await playOut(cup.id);
    expect(done?.status).toBe("COMPLETED");
    const champion = done!.winner!;
    expect(done!.awards!.map((a) => a.place)).toEqual([0, 1, 2, 2]);
    expect(done!.awards![0]).toMatchObject({ userId: champion, xp: 500, credits: 100, prize: "Gold badge" });
    const stats = await tx((x) => x.gameStats.getMany([champion], "chess"));
    expect(stats[champion].xp).toBeGreaterThanOrEqual(500);
    expect((await tx((x) => userBalances(x, champion))).freeCredits).toBe(100 * 100);
  });

  it("a tournament without enough players is cancelled; admins can cancel or start one early", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 10, 0));
    await saveTournamentSeries(await admin("owner"), {
      series: [
        {
          id: "ev-a",
          name: "Launch Event",
          kind: "event",
          game: "backgammon",
          date: "2026-11-03",
          time: "12:00",
          size: 16,
          minPlayers: 4,
          registrationHours: 48,
        },
        {
          id: "ev-b",
          name: "Second Event",
          kind: "event",
          game: "backgammon",
          date: "2026-11-03",
          time: "13:00",
          size: 16,
          minPlayers: 4,
          registrationHours: 48,
        },
        { id: "ev-c", name: "Third Event", kind: "event", game: "chess", date: "2026-11-03", time: "14:00", size: 16, minPlayers: 4, registrationHours: 48 },
      ],
    });
    const { open } = await listTournaments(null);
    const [a, b, c] = ["Launch Event", "Second Event", "Third Event"].map((n) => open.find((t) => t.name === n)!);
    const p = [await ensureAccount(), await ensureAccount()];
    for (const x of p) {
      await register(x.id, a.id);
      await register(x.id, c.id);
    }
    await tournamentAction(await admin("operator"), b.id, { action: "cancel", reason: "Moved to next week" });
    expect((await getTournament(null, b.id)).cancelReason).toBe("Moved to next week");
    await tournamentAction(await admin("operator"), c.id, { action: "start" });
    const started = await getTournament(null, c.id);
    expect(started).toMatchObject({ status: "RUNNING", size: 2 });

    // A drawn chess game sends the player with Black through.
    const matchId = started.rounds[0][0].matchId!;
    const rec = (await tx((x) => x.matches.get(matchId)))!;
    const act = async (userId: string, actionType: string, payload?: Record<string, unknown>) => {
      const snap = await getSnapshot(userId, matchId);
      await submitAction(userId, matchId, { actionId: `${actionType}-${userId}`, expectedVersion: snap.stateVersion, actionType, payload });
    };
    const white = rec.seats[rec.chess!.white]!;
    const black = rec.seats[1 - rec.chess!.white]!;
    await act(white, "MOVE", { uci: "e2e4" });
    await act(black, "MOVE", { uci: "e7e5" });
    await act(white, "OFFER_DRAW");
    await act(black, "ACCEPT_DRAW");
    const after = await tx((x) => x.tournaments.get(c.id));
    expect(after?.status).toBe("COMPLETED");
    expect(after?.winner).toBe(black);

    vi.setSystemTime(Date.UTC(2026, 10, 3, 12, 5));
    const late = await getTournament(null, a.id);
    expect(late.status).toBe("CANCELLED");
    expect(late.cancelReason).toMatch(/Not enough players/);
  });
});
