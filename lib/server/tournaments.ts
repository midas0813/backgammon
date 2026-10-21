import { randomInt, randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { DEFAULT_REWARDS, PLACES, nextStart, seriesFromSetting, type TournamentSeries } from "../tournaments";
import { ApiError, notFound } from "./errors";
import { grantTournamentCredits } from "./ledger";
import { createPairedMatchIn } from "./matches";
import { tx, type MatchRecord, type TournamentDoc, type Tx } from "./store";
import { assertActive, avatarUrl } from "./users";

/**
 * Free single-elimination tournaments for every game, organised only by admins as series:
 *  - sit & go tables start the moment they are full, and a new table opens;
 *  - weekly, monthly and event tournaments open registration ahead of their start time, and start
 *    then with whoever registered (byes for the top seeds), or are cancelled without enough players.
 * Players are seeded by their rating in the game. Winners move on as soon as their next opponent is
 * known; finishers get the series' rewards (XP in the game, practice credits, a described prize).
 * Tournaments are for wallet accounts; guests can watch the brackets.
 */
export const SERIES_SETTING = "tournamentSeries";
/** How often a server process checks the schedule (each page load would be wasteful). */
const SYNC_MS = 10_000;

const newId = () => randomUUID().replace(/-/g, "").slice(0, 10);
const lastSync = ((globalThis as unknown as { __bgTourSync?: { at: number } }).__bgTourSync ??= { at: 0 });

/** Tests: the next request checks the schedule again (the store was reset). */
export function invalidateTournamentSync() {
  lastSync.at = 0;
}

export async function loadSeries(t: Tx) {
  return seriesFromSetting(await t.admin.getSetting(SERIES_SETTING));
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

function fromSeries(s: TournamentSeries, id: string, startsAt?: number): TournamentDoc {
  return {
    id,
    name: s.name,
    template: s.id,
    game: s.game,
    kind: s.kind,
    size: s.size,
    minPlayers: s.minPlayers,
    points: s.points,
    clock: s.clock,
    timeControl: s.game === "chess" ? s.timeControl : undefined,
    description: s.description || undefined,
    rewards: s.rewards,
    startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
    status: "REGISTERING",
    players: [],
    rounds: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Bring the tournaments in line with the admin's series: one open table per sit & go series, the
 * next weekly/monthly/event tournament once its registration opens, and scheduled ones started (or
 * cancelled) when their time comes.
 */
export async function syncTournaments(t: Tx, now = Date.now(), force = false) {
  if (!force && now - lastSync.at < SYNC_MS && now >= lastSync.at) return;
  lastSync.at = now;
  await t.lock("tournaments:sync");
  const series = await loadSeries(t);
  const open = await t.tournaments.list(["REGISTERING"], 200);
  for (const s of series) {
    if (s.kind === "sitgo") {
      const table = open.find((d) => d.template === s.id && (d.kind ?? "sitgo") === "sitgo");
      if (!s.enabled) continue;
      if (!table) await t.tournaments.put(fromSeries(s, newId()));
      // An empty table follows the series' latest settings.
      else if (!table.players.length) await t.tournaments.put({ ...fromSeries(s, table.id), createdAt: table.createdAt });
      continue;
    }
    if (!s.enabled) continue;
    const startsAt = nextStart(s, now);
    if (startsAt === null || now < startsAt - s.registrationHours * 3_600_000) continue;
    const id = `${s.id}-${stamp(startsAt)}`;
    const existing = await t.tournaments.get(id);
    if (!existing) await t.tournaments.put(fromSeries(s, id, startsAt));
    else if (existing.status === "REGISTERING" && !existing.players.length)
      await t.tournaments.put({ ...fromSeries(s, id, startsAt), createdAt: existing.createdAt });
  }
  // Empty sit & go tables of a series that was switched off or removed close.
  for (const d of open) {
    if ((d.kind ?? "sitgo") !== "sitgo" || d.players.length) continue;
    const s = series.find((x) => x.id === d.template);
    if (!s || !s.enabled) await t.tournaments.put({ ...d, status: "CANCELLED", cancelReason: "Closed by the organisers" });
  }
  // Scheduled tournaments whose time has come.
  for (const d of open) {
    if (!d.startsAt || Date.parse(d.startsAt) > now) continue;
    const locked = await t.tournaments.get(d.id, { lock: true });
    if (locked?.status === "REGISTERING") await kickOff(t, locked);
  }
}

/** Start a scheduled tournament with whoever registered, or cancel it if too few did. */
async function kickOff(t: Tx, d: TournamentDoc) {
  if (d.players.length < Math.max(2, d.minPlayers ?? 2)) {
    d.status = "CANCELLED";
    d.cancelReason = `Not enough players (${d.players.length} of ${d.minPlayers ?? 2} needed)`;
    d.completedAt = new Date().toISOString();
  } else await start(t, d);
  await t.tournaments.put(d);
}

type View = ReturnType<typeof view>;

function view(d: TournamentDoc, userId: string | null, users: Record<string, { avatar?: string; name: string }>) {
  const name = (id: string | null) => (id ? (d.players.find((p) => p.userId === id)?.name ?? "Player") : null);
  return {
    id: d.id,
    name: d.name,
    game: d.game ?? "backgammon",
    kind: d.kind ?? "sitgo",
    size: d.size,
    minPlayers: d.minPlayers ?? d.size,
    points: d.points,
    clock: d.clock,
    timeControl: d.timeControl ?? null,
    description: d.description ?? null,
    startsAt: d.startsAt ?? null,
    rewards: d.rewards ?? DEFAULT_REWARDS.sitgo,
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
        bye: !!s.bye,
        mine: !!userId && (s.a === userId || s.b === userId),
      })),
    ),
    winner: d.winner ? name(d.winner) : null,
    awards: (d.awards ?? []).map((a) => ({ name: a.name, place: PLACES[a.place], xp: a.xp, credits: a.credits, prize: a.prize, me: a.userId === userId })),
    cancelReason: d.cancelReason ?? null,
    createdAt: d.createdAt,
    startedAt: d.startedAt ?? null,
    completedAt: d.completedAt ?? null,
  };
}

/** Upcoming first (scheduled by start time, then sit & go tables), then running, then recent results. */
export function listTournaments(userId: string | null) {
  return tx(async (t) => {
    await syncTournaments(t);
    const docs = [...(await t.tournaments.list(["REGISTERING", "RUNNING"], 60)), ...(await t.tournaments.list(["COMPLETED"], 12))];
    const users = await t.users.getMany([...new Set(docs.flatMap((d) => d.players.map((p) => p.userId)))]);
    const v = docs.map((d) => view(d, userId, users));
    const when = (x: View) => (x.startsAt ? Date.parse(x.startsAt) : Number.MAX_SAFE_INTEGER);
    return {
      open: v.filter((d) => d.status === "REGISTERING").sort((a, b) => when(a) - when(b)),
      running: v.filter((d) => d.status === "RUNNING"),
      finished: v.filter((d) => d.status === "COMPLETED"),
    };
  });
}

export function getTournament(userId: string | null, id: string) {
  return tx(async (t) => {
    await syncTournaments(t);
    const d = await t.tournaments.get(id);
    if (!d) throw notFound("Tournament");
    return view(d, userId, await t.users.getMany(d.players.map((p) => p.userId)));
  });
}

export type TournamentView = Awaited<ReturnType<typeof getTournament>>;

/** Join (wallet accounts only, not guests). A sit & go starts when its last seat fills. */
export function register(userId: string, id: string) {
  return tx(async (t) => {
    const d = await t.tournaments.get(id, { lock: true });
    if (!d) throw notFound("Tournament");
    if (d.status !== "REGISTERING") throw new ApiError(409, "EVENT_FULL", "This tournament has already started");
    if (d.players.some((p) => p.userId === userId)) return { status: d.status };
    if (d.players.length >= d.size) throw new ApiError(409, "EVENT_FULL", "This tournament is full");
    const user = await t.users.get(userId);
    assertActive(user);
    if (!user?.walletAddress) throw new ApiError(403, "WALLET_REQUIRED", "Connect a wallet to join tournaments. Guests can still play free games.");
    d.players.push({ userId, name: user?.name ?? "Player", seed: 0 });
    if (!d.startsAt && d.players.length >= d.size) {
      await start(t, d);
      // A new table for the next group opens on the next look.
      invalidateTournamentSync();
    }
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

/** Bracket positions of seeds 1…n (n a power of two): 1 v n, and the top seeds meet as late as possible. */
function seedOrder(n: number) {
  let o = [1];
  while (o.length < n) {
    const m = o.length * 2;
    o = o.flatMap((x) => [x, m + 1 - x]);
  }
  return o;
}

/** Seed by rating in the game (random among equals), build the bracket with byes, and pair round one. */
async function start(t: Tx, d: TournamentDoc) {
  const stats = await t.gameStats.getMany(
    d.players.map((p) => p.userId),
    d.game ?? "backgammon",
  );
  const order = d.players.map((p) => ({ p, rating: stats[p.userId]?.rating ?? 1500, tie: randomInt(1_000_000) }));
  order.sort((x, y) => y.rating - x.rating || x.tie - y.tie);
  order.forEach((o, i) => (o.p.seed = i + 1));
  d.players = order.map((o) => o.p);
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, d.players.length)));
  d.size = d.startsAt ? size : d.size;
  const positions = seedOrder(size);
  const seat = (seed: number) => d.players[seed - 1]?.userId ?? null;
  d.rounds = Array.from({ length: Math.log2(size) }, (_, r) =>
    Array.from({ length: size / 2 ** (r + 1) }, () => ({ a: null, b: null, matchId: null, winner: null })),
  );
  d.status = "RUNNING";
  d.startedAt = new Date().toISOString();
  for (let k = 0; k < d.rounds[0].length; k++) {
    const slot = d.rounds[0][k];
    slot.a = seat(positions[2 * k]);
    slot.b = seat(positions[2 * k + 1]);
    if (!slot.b) {
      slot.bye = true;
      await settle(t, d, 0, k, slot.a);
    } else slot.matchId = await pair(t, d, slot.a!, slot.b);
  }
}

const pair = (t: Tx, d: TournamentDoc, a: string, b: string) =>
  createPairedMatchIn(t, a, b, { game: d.game, points: d.points, clock: d.clock, timeControl: d.timeControl, tournamentId: d.id });

/** Record a winner and move them on; the final crowns the champion and hands out the rewards. */
async function settle(t: Tx, d: TournamentDoc, r: number, k: number, winner: string | null) {
  d.rounds[r][k].winner = winner;
  if (r === d.rounds.length - 1) {
    d.status = "COMPLETED";
    d.winner = winner!;
    d.completedAt = new Date().toISOString();
    await award(t, d);
    return;
  }
  const next = d.rounds[r + 1][Math.floor(k / 2)];
  if (k % 2 === 0) next.a = winner;
  else next.b = winner;
  if (next.a && next.b && !next.matchId) next.matchId = await pair(t, d, next.a, next.b);
}

const seedOf = (d: TournamentDoc, id: string | null) => d.players.find((p) => p.userId === id)?.seed ?? 99;

/**
 * A tournament match ended: record the winner and pair the next round. If nobody played, the better
 * seed goes through; a drawn chess game goes to the player with Black (as in an Armageddon tiebreak).
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
  let winner: string | null;
  if (rec.state.status === "COMPLETED" && (w === 0 || w === 1)) winner = rec.seats[w];
  else if (rec.state.status === "COMPLETED" && rec.chess?.result) winner = rec.seats[1 - rec.chess.white];
  else {
    winner = seedOf(d, slot.a) <= seedOf(d, slot.b) ? slot.a : slot.b;
    slot.walkover = true;
  }
  await settle(t, d, r, k, winner);
  await t.tournaments.put(d);
}

/** Rewards by finishing place: the final's two players, then the semi- and quarter-final losers. */
async function award(t: Tx, d: TournamentDoc) {
  const rewards = d.rewards ?? DEFAULT_REWARDS.sitgo;
  const last = d.rounds.length - 1;
  // A final nobody turned up for crowns the better seed, but without the champion's reward.
  const places: { userId: string; place: number }[] = d.rounds[last][0].walkover ? [] : [{ userId: d.winner!, place: 0 }];
  for (let r = last; r >= Math.max(0, last - 2); r--) {
    for (const s of d.rounds[r]) {
      const loser = s.winner === s.a ? s.b : s.a;
      // A no-show earns nothing; a bye has no loser.
      if (loser && !s.walkover && !s.bye) places.push({ userId: loser, place: last - r + 1 });
    }
  }
  d.awards = [];
  for (const { userId, place } of places) {
    const r = rewards[place];
    if (!r || (!r.xp && !r.credits && !r.prize)) continue;
    if (r.xp) await t.gameStats.addXp(userId, d.game ?? "backgammon", r.xp);
    if (r.credits) await grantTournamentCredits(t, userId, d.id, r.credits * TOKEN_SCALE);
    d.awards.push({ userId, name: d.players.find((p) => p.userId === userId)?.name ?? "Player", place, xp: r.xp, credits: r.credits, prize: r.prize });
  }
}

/** Tournament matches waiting for this player that they have not opened yet (for the in-app call). */
export function readyMatches(userId: string) {
  return tx(async (t) => {
    await syncTournaments(t);
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

// ---- Admin --------------------------------------------------------------------------------------

/** Series and recent tournaments with who won what (user ids included, for the admin area). */
export async function adminTournamentsIn(t: Tx) {
  await syncTournaments(t, Date.now(), true);
  const docs = [...(await t.tournaments.list(["REGISTERING", "RUNNING"], 60)), ...(await t.tournaments.list(["COMPLETED", "CANCELLED"], 30))];
  return {
    series: await loadSeries(t),
    tournaments: docs.map((d) => ({ ...view(d, null, {}), awards: (d.awards ?? []).map((a) => ({ ...a, place: PLACES[a.place] })) })),
  };
}

/** Cancel a tournament that hasn't finished. Matches already being played finish on their own. */
export async function cancelTournamentIn(t: Tx, id: string, reason: string) {
  const d = await t.tournaments.get(id, { lock: true });
  if (!d) throw notFound("Tournament");
  if (d.status === "COMPLETED" || d.status === "CANCELLED") throw new ApiError(409, "WRONG_PHASE", "This tournament has already ended");
  d.status = "CANCELLED";
  d.cancelReason = reason;
  d.completedAt = new Date().toISOString();
  await t.tournaments.put(d);
  return d;
}

/** Start a tournament now with whoever registered (at least two players). */
export async function startTournamentNowIn(t: Tx, id: string) {
  const d = await t.tournaments.get(id, { lock: true });
  if (!d) throw notFound("Tournament");
  if (d.status !== "REGISTERING") throw new ApiError(409, "WRONG_PHASE", "This tournament is not open for registration");
  if (d.players.length < 2) throw new ApiError(409, "WRONG_PHASE", "At least two players must be registered");
  // A sit & go started early is sized to who is there, like a scheduled one.
  d.startsAt ??= new Date().toISOString();
  await start(t, d);
  await t.tournaments.put(d);
  return d;
}
