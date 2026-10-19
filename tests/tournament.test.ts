import { afterEach, describe, expect, it, vi } from "vitest";
import { getSnapshot, leaveMatch, setEnvForTests, sweep } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { getTournament, listTournaments, readyMatches, register, unregister } from "@/lib/server/tournaments";
import { ensureUser } from "@/lib/server/users";
import { ensureAccount, randomEnv } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("sit & go tournaments", () => {
  it("starts when full, advances winners and crowns a champion", async () => {
    setEnvForTests(randomEnv(500));
    const { open } = await listTournaments(null);
    const quick = open.find((t) => t.size === 4)!;
    const players = [];
    for (let i = 0; i < 4; i++) players.push(await ensureAccount());
    await register(players[0].id, quick.id);
    await unregister(players[0].id, quick.id);
    for (const p of players) await register(p.id, quick.id);

    let t = await getTournament(players[0].id, quick.id);
    expect(t.status).toBe("RUNNING");
    expect(t.rounds[0].every((s) => s.matchId)).toBe(true);
    // A new open table appears for the next group.
    expect((await listTournaments(null)).open.some((x) => x.size === 4 && x.id !== quick.id)).toBe(true);
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
    const quick = open.find((t) => t.size === 4)!;
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
    const quick = open.find((t) => t.size === 4)!;
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
