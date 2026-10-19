import { randomInt, randomUUID } from "node:crypto";
import { ApiError, notFound } from "./errors";
import { createPairedMatchIn } from "./matches";
import { tx, type MatchRecord, type TournamentDoc, type Tx } from "./store";
import { assertActive, avatarUrl } from "./users";

/**
 * Free single-elimination tournaments, "sit & go": a table of 4 or 8 opens, starts the moment it is
 * full, and pairs the bracket automatically. Winners move on as soon as their next opponent is known.
 * Tournaments are for wallet accounts; guests can watch the brackets. Paid tournaments wait on the open decisions (entry, refunds, payouts) in spec 05.
 */
export const TEMPLATES = [
  { key: "quick4", name: "Quick 4", size: 4, points: 1, clock: "fast" as const },
  { key: "classic8", name: "Classic 8", size: 8, points: 3, clock: "standard" as const },
];
/** XP for the champion and the runner-up. */
export const TOURNAMENT_XP = { winner: 200, runnerUp: 100 };

const newId = () => randomUUID().replace(/-/g, "").slice(0, 10);

/** Keep one open table per template. */
async function ensureOpen(t: Tx) {
  const open = await t.tournaments.list(["REGISTERING"], 50);
  for (const tpl of TEMPLATES) {
    if (open.some((d) => d.template === tpl.key)) continue;
    await t.tournaments.put({
      id: newId(),
      name: tpl.name,
      template: tpl.key,
      size: tpl.size,
      points: tpl.points,
      clock: tpl.clock,
      status: "REGISTERING",
      players: [],
      rounds: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function view(d: TournamentDoc, userId: string | null, users: Record<string, { avatar?: string; name: string }>) {
  const name = (id: string | null) => (id ? (d.players.find((p) => p.userId === id)?.name ?? "Player") : null);
  return {
    id: d.id,
    name: d.name,
    size: d.size,
    points: d.points,
    clock: d.clock,
    status: d.status,
    registered: d.players.length,
    joined: !!userId && d.players.some((p) => p.userId === userId),
    players: d.players.map((p) => ({ name: p.name, avatarUrl: avatarUrl(users[p.userId]), seed: p.seed, me: p.userId === userId })),
    rounds: d.rounds.map((round) =>
      round.map((s) => ({
        a: name(s.a),
        b: name(s.b),
        matchId: s.matchId,
        winner: name(s.winner),
        walkover: !!s.walkover,
        mine: !!userId && (s.a === userId || s.b === userId),
      })),
    ),
    winner: d.winner ? name(d.winner) : null,
    createdAt: d.createdAt,
    startedAt: d.startedAt ?? null,
    completedAt: d.completedAt ?? null,
  };
}

export function listTournaments(userId: string | null) {
  return tx(async (t) => {
    await ensureOpen(t);
    const docs = [...(await t.tournaments.list(["REGISTERING", "RUNNING"], 20)), ...(await t.tournaments.list(["COMPLETED"], 10))];
    const users = await t.users.getMany([...new Set(docs.flatMap((d) => d.players.map((p) => p.userId)))]);
    const v = docs.map((d) => view(d, userId, users));
    return {
      open: v.filter((d) => d.status === "REGISTERING"),
      running: v.filter((d) => d.status === "RUNNING"),
      finished: v.filter((d) => d.status === "COMPLETED"),
    };
  });
}

export function getTournament(userId: string | null, id: string) {
  return tx(async (t) => {
    const d = await t.tournaments.get(id);
    if (!d) throw notFound("Tournament");
    return view(d, userId, await t.users.getMany(d.players.map((p) => p.userId)));
  });
}

export type TournamentView = Awaited<ReturnType<typeof getTournament>>;

/** Join a table (wallet accounts only, not guests); the last seat starts the tournament. */
export function register(userId: string, id: string) {
  return tx(async (t) => {
    const d = await t.tournaments.get(id, { lock: true });
    if (!d) throw notFound("Tournament");
    if (d.status !== "REGISTERING") throw new ApiError(409, "EVENT_FULL", "This tournament has already started");
    if (d.players.some((p) => p.userId === userId)) return { status: d.status };
    const user = await t.users.get(userId);
    assertActive(user);
    if (!user?.walletAddress) throw new ApiError(403, "WALLET_REQUIRED", "Connect a wallet to join tournaments. Guests can still play free games.");
    d.players.push({ userId, name: user?.name ?? "Player", seed: 0 });
    if (d.players.length >= d.size) await start(t, d);
    await t.tournaments.put(d);
    return { status: d.status };
  });
}

export function unregister(userId: string, id: string) {
  return tx(async (t) => {
    const d = await t.tournaments.get(id, { lock: true });
    if (!d) throw notFound("Tournament");
    if (d.status !== "REGISTERING") throw new ApiError(409, "WRONG_PHASE", "The tournament has started");
    d.players = d.players.filter((p) => p.userId !== userId);
    await t.tournaments.put(d);
    return { status: d.status };
  });
}

/** Shuffle, seed and create the first round's matches. */
async function start(t: Tx, d: TournamentDoc) {
  const order = [...d.players];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((p, i) => (p.seed = i + 1));
  d.players = order;
  const rounds = Math.log2(d.size);
  d.rounds = Array.from({ length: rounds }, (_, r) => Array.from({ length: d.size / 2 ** (r + 1) }, () => ({ a: null, b: null, matchId: null, winner: null })));
  d.status = "RUNNING";
  d.startedAt = new Date().toISOString();
  for (let k = 0; k < d.rounds[0].length; k++) {
    const slot = d.rounds[0][k];
    slot.a = order[2 * k].userId;
    slot.b = order[2 * k + 1].userId;
    slot.matchId = await createPairedMatchIn(t, slot.a, slot.b, d.points, { clock: d.clock, tournamentId: d.id });
  }
}

const seedOf = (d: TournamentDoc, id: string | null) => d.players.find((p) => p.userId === id)?.seed ?? 99;

/**
 * A tournament match ended: record the winner (if nobody played, the better seed goes through) and
 * pair the next round as soon as both players are known. The final crowns the champion.
 */
export async function advanceTournament(t: Tx, rec: MatchRecord) {
  const d = await t.tournaments.get(rec.tournamentId!, { lock: true });
  if (!d || d.status !== "RUNNING") return;
  const r = d.rounds.findIndex((round) => round.some((s) => s.matchId === rec.id));
  if (r < 0) return;
  const k = d.rounds[r].findIndex((s) => s.matchId === rec.id);
  const slot = d.rounds[r][k];
  if (slot.winner) return;
  const w = rec.state.winner;
  if (rec.state.status === "COMPLETED" && (w === 0 || w === 1)) slot.winner = rec.seats[w];
  else {
    slot.winner = seedOf(d, slot.a) <= seedOf(d, slot.b) ? slot.a : slot.b;
    slot.walkover = true;
  }
  if (r === d.rounds.length - 1) {
    d.status = "COMPLETED";
    d.winner = slot.winner!;
    d.completedAt = new Date().toISOString();
    const runnerUp = slot.winner === slot.a ? slot.b : slot.a;
    await t.users.addXp(d.winner, TOURNAMENT_XP.winner);
    if (runnerUp) await t.users.addXp(runnerUp, TOURNAMENT_XP.runnerUp);
  } else {
    const next = d.rounds[r + 1][Math.floor(k / 2)];
    if (k % 2 === 0) next.a = slot.winner;
    else next.b = slot.winner;
    if (next.a && next.b && !next.matchId) next.matchId = await createPairedMatchIn(t, next.a, next.b, d.points, { clock: d.clock, tournamentId: d.id });
  }
  await t.tournaments.put(d);
}

/** Tournament matches waiting for this player that they have not opened yet (for the in-app call). */
export function readyMatches(userId: string) {
  return tx(async (t) => {
    const out = [];
    for (const m of await t.matches.listOpen(userId, 5)) {
      if (m.status !== "ACTIVE" || m.mode !== "private") continue;
      const rec = await t.matches.get(m.id);
      if (!rec?.tournamentId) continue;
      const seat = rec.seats.indexOf(userId);
      const seen = await t.presence.get(m.id);
      if (seen[seat] > 0) continue;
      const doc = await t.tournaments.get(rec.tournamentId);
      out.push({ matchId: m.id, opponent: rec.names[1 - seat], tournament: doc?.name ?? "Tournament" });
    }
    return out;
  });
}
