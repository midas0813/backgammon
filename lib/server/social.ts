import { ApiError, notFound } from "./errors";
import { ONLINE_WINDOW_MS } from "./lobby";
import { createMatch, joinMatch } from "./matches";
import { tx, type Friendship, type Tx } from "./store";
import { levelOf } from "../quests";
import { avatarUrl } from "./users";

/**
 * Friends, direct invites and rematches. Players never see each other's account IDs: friendships and
 * invites are addressed by their own row IDs.
 */
const other = (f: Friendship, me: string) => (f.userA === me ? f.userB : f.userA);

async function opponentIn(t: Tx, userId: string, matchId: string) {
  const rec = await t.matches.get(matchId);
  if (!rec) throw notFound("Match");
  const seat = rec.seats.indexOf(userId);
  if (seat < 0) throw new ApiError(403, "NOT_PARTICIPANT", "You did not play this match");
  const opp = rec.seats[1 - seat];
  if (!opp || opp === "bot" || opp === userId) throw new ApiError(409, "WRONG_PHASE", "There is no other player in this match");
  return { rec, opp };
}

/** Send a friend request to your opponent in a match (or accept theirs). */
export function addFriendFromMatch(userId: string, matchId: string) {
  return tx(async (t) => {
    const { opp } = await opponentIn(t, userId, matchId);
    const f = await t.friends.get(userId, opp);
    if (f?.status === "ACCEPTED") return { status: "ACCEPTED" as const };
    const accept = f?.status === "PENDING" && f.requestedBy === opp;
    await t.friends.put({ userA: userId, userB: opp, requestedBy: accept ? opp : userId, status: accept ? "ACCEPTED" : "PENDING" });
    return { status: accept ? ("ACCEPTED" as const) : ("PENDING" as const) };
  });
}

export function respondFriend(userId: string, id: number, accept: boolean) {
  return tx(async (t) => {
    const f = await t.friends.byId(id);
    if (!f || (f.userA !== userId && f.userB !== userId)) throw notFound("Friend request");
    if (!accept) {
      await t.friends.remove(id);
      return { status: "REMOVED" as const };
    }
    if (f.status !== "PENDING" || f.requestedBy === userId) throw new ApiError(409, "WRONG_PHASE", "Nothing to accept");
    await t.friends.put({ ...f, status: "ACCEPTED" });
    return { status: "ACCEPTED" as const };
  });
}

/** Your friends (online first), incoming and outgoing requests. */
export function listFriends(userId: string, now = Date.now()) {
  return tx(async (t) => {
    const rows = await t.friends.list(userId);
    const ids = rows.map((f) => other(f, userId));
    const users = await t.users.getMany(ids);
    const seen = await t.users.seenMany(ids);
    const view = async (f: Friendship) => {
      const id = other(f, userId);
      const u = users[id];
      const game = f.status === "ACCEPTED" ? (await t.matches.listOpen(id, 1))[0] : undefined;
      return {
        id: f.id,
        name: u?.name ?? "Player",
        avatarUrl: avatarUrl(u),
        frame: u?.frame ?? "none",
        level: levelOf(u?.xp ?? 0).level,
        rating: Math.round(u?.rating ?? 1500),
        online: now - (seen[id] ?? 0) < ONLINE_WINDOW_MS,
        playing: game
          ? { matchId: game.id, watchable: game.status === "ACTIVE" && game.allowSpectators && (game.mode === "quick" || game.mode === "private") }
          : null,
      };
    };
    const accepted = await Promise.all(rows.filter((f) => f.status === "ACCEPTED").map(view));
    return {
      friends: accepted.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      incoming: await Promise.all(rows.filter((f) => f.status === "PENDING" && f.requestedBy !== userId).map(view)),
      outgoing: await Promise.all(rows.filter((f) => f.status === "PENDING" && f.requestedBy === userId).map(view)),
    };
  });
}

/** Invite a friend: opens an invite-only table and sends them the invite. */
export async function inviteFriend(userId: string, friendshipId: number, body: { targetPoints?: unknown; clock?: unknown; clientSeed?: unknown }) {
  const f = await tx((t) => t.friends.byId(friendshipId));
  if (!f || f.status !== "ACCEPTED" || (f.userA !== userId && f.userB !== userId)) throw notFound("Friend");
  const points = [1, 3, 5, 7].includes(Number(body.targetPoints)) ? Number(body.targetPoints) : 3;
  const clock = body.clock === "fast" || body.clock === "none" ? body.clock : "standard";
  const { matchId } = await createMatch(userId, "private", points, { clock, clientSeed: body.clientSeed });
  await tx((t) => t.invites.add({ fromUser: userId, toUser: other(f, userId), matchId }));
  return { matchId };
}

/** Invites waiting for you whose table is still open (others lapse). */
export function pendingInvites(userId: string) {
  return tx(async (t) => {
    const out = [];
    for (const i of await t.invites.pendingFor(userId)) {
      const rec = await t.matches.get(i.matchId);
      if (!rec || rec.state.status !== "WAITING") {
        await t.invites.setStatus(i.id, "EXPIRED");
        continue;
      }
      out.push({
        id: i.id,
        from: rec.names[0],
        matchId: i.matchId,
        targetPoints: rec.state.targetPoints,
        clock: rec.clock?.preset ?? "none",
        rematch: !!i.rematchOf,
      });
    }
    return out;
  });
}

export async function respondInvite(userId: string, id: number, accept: boolean, clientSeed?: unknown) {
  const inv = await tx((t) => t.invites.get(id));
  if (!inv || inv.toUser !== userId || inv.status !== "PENDING") throw notFound("Invite");
  if (!accept) {
    await tx((t) => t.invites.setStatus(id, "DECLINED"));
    return { status: "DECLINED" as const };
  }
  await joinMatch(userId, inv.matchId, clientSeed);
  await tx((t) => t.invites.setStatus(id, "ACCEPTED"));
  return { status: "ACCEPTED" as const, matchId: inv.matchId };
}

/**
 * Rematch after a finished online match: joins the opponent's rematch if they already asked,
 * otherwise opens an invite-only table with the same length and clock and invites them.
 */
export async function rematch(userId: string, matchId: string, clientSeed?: unknown) {
  const { rec, opp } = await tx((t) => opponentIn(t, userId, matchId));
  if (rec.state.status === "WAITING" || rec.state.status === "ACTIVE") throw new ApiError(409, "WRONG_PHASE", "This match is still going");
  if (rec.mode !== "quick" && rec.mode !== "private") throw new ApiError(409, "WRONG_PHASE", "Rematches are for online matches");
  const theirs = await tx((t) => t.invites.rematch(matchId, opp));
  if (theirs) {
    await joinMatch(userId, theirs.matchId, clientSeed);
    await tx((t) => t.invites.setStatus(theirs.id, "ACCEPTED"));
    return { matchId: theirs.matchId, joined: true };
  }
  const mine = await tx((t) => t.invites.rematch(matchId, userId));
  if (mine) return { matchId: mine.matchId, joined: false };
  const { matchId: next } = await createMatch(userId, "private", rec.state.targetPoints, { clock: rec.clock?.preset ?? "none", clientSeed });
  await tx((t) => t.invites.add({ fromUser: userId, toUser: opp, matchId: next, rematchOf: matchId }));
  return { matchId: next, joined: false };
}
