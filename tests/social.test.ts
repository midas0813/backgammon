import { describe, expect, it } from "vitest";
import { framesFromEvents } from "@/lib/client/replayFrames";
import { createTable } from "@/lib/server/lobby";
import { getSnapshot, joinMatch, leaveMatch, matchHistory, setEnvForTests } from "@/lib/server/matches";
import { addFriendFromMatch, inviteFriend, listFriends, pendingInvites, rematch, respondFriend, respondInvite } from "@/lib/server/social";
import { ensureUser } from "@/lib/server/users";
import { randomEnv } from "./helpers";

async function finishedMatch() {
  setEnvForTests(randomEnv(400));
  const a = await ensureUser(undefined);
  const b = await ensureUser(undefined);
  const { matchId } = await createTable(a.id, { targetPoints: 3, clock: "fast" });
  await joinMatch(b.id, matchId);
  await leaveMatch(b.id, matchId);
  return { a, b, matchId };
}

describe("friends and invites", () => {
  it("friends from a match, then invite one straight to a game", async () => {
    const { a, b, matchId } = await finishedMatch();
    expect(await addFriendFromMatch(a.id, matchId)).toEqual({ status: "PENDING" });
    const incoming = (await listFriends(b.id)).incoming;
    expect(incoming.map((f) => f.name)).toEqual([a.name]);
    expect(await respondFriend(b.id, incoming[0].id, true)).toEqual({ status: "ACCEPTED" });
    const [friend] = (await listFriends(a.id)).friends;
    expect(friend).toMatchObject({ name: b.name, online: true });

    const { matchId: table } = await inviteFriend(a.id, friend.id, { targetPoints: 5 });
    const [inv] = await pendingInvites(b.id);
    expect(inv).toMatchObject({ from: a.name, matchId: table, targetPoints: 5, rematch: false });
    expect(await respondInvite(b.id, inv.id, true)).toMatchObject({ status: "ACCEPTED", matchId: table });
    expect((await getSnapshot(a.id, table)).status).toBe("ACTIVE");
    expect(await pendingInvites(b.id)).toEqual([]);
  });

  it("rematch: both pressing it lands in the same new match", async () => {
    const { a, b, matchId } = await finishedMatch();
    const first = await rematch(a.id, matchId);
    expect(first.joined).toBe(false);
    expect((await pendingInvites(b.id))[0]).toMatchObject({ rematch: true, matchId: first.matchId });
    const second = await rematch(b.id, matchId);
    expect(second).toEqual({ matchId: first.matchId, joined: true });
    expect((await getSnapshot(a.id, first.matchId)).status).toBe("ACTIVE");
  });

  it("rebuilds every position of a match for the replay", async () => {
    setEnvForTests(randomEnv(401));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createTable(a.id, { targetPoints: 1, clock: "none" });
    await joinMatch(b.id, matchId);
    await leaveMatch(b.id, matchId);
    const h = await matchHistory(a.id, matchId, 0);
    const frames = framesFromEvents(h.events, ["A", "B"]);
    expect(frames[0].caption).toMatch(/opening roll/);
    expect(frames[frames.length - 1].caption).toMatch(/wins the match/);
    expect(frames.every((f) => f.board.points.length === 24)).toBe(true);
  });
});
