import { levelOf, weekKey } from "../quests";
import { PROVISIONAL_GAMES, START_RATING, eloChange, ratingChange } from "../rating";
import { ApiError, notFound } from "./errors";
import { SYSTEM, post, userAccount } from "./ledger";
import { operatorSettings } from "./settings";
import { tx, type MatchRecord, type MatchResultRow, type PrizeWeek, type Tx } from "./store";
import { avatarUrl, isSuspended } from "./users";

/**
 * Weekly leaderboard and free prize pool (Phase 2). Points for online matches against real players:
 * win 2 × match length, loss 1, +1 per gammon won. Only a few matches a day against the same opponent
 * count. Each week the top eligible players (wallet account, enough different opponents) win the pool
 * after an admin's check.
 */
export const POINTS = { winPerMatchPoint: 2, loss: 1, gammonBonus: 1, /** chess */ draw: 1 };
/** Matches against the same opponent that count toward points per day. */
export const DAILY_PAIR_CAP = 3;

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Leaderboard points for each result of a finished match (called before the rows are stored). */
export async function withLeaderboardPoints(t: Tx, rec: MatchRecord, rows: MatchResultRow[]) {
  const online = rec.mode === "quick" || rec.mode === "private";
  // A game really played: not an instant forfeit (chess: both sides moved).
  const realGame = rec.chess ? rec.chess.moves.length >= 2 : rec.state.results.some((r) => r.kind !== "forfeit");
  const draw = !!rec.chess && rec.state.winner === null;
  const dayStart = Date.now() - (Date.now() % DAY);
  for (const r of rows) {
    r.lbPoints = 0;
    if (!online || !r.opponentId || !realGame) continue;
    const earlier = await t.results.countAgainst(r.userId, r.opponentId, dayStart, { played: true });
    if (earlier >= DAILY_PAIR_CAP) continue;
    r.lbPoints = draw ? POINTS.draw : (r.won ? POINTS.winPerMatchPoint * r.targetPoints : POINTS.loss) + POINTS.gammonBonus * r.gammons;
  }
  return rows;
}

/**
 * Ranked matches between two people move both ratings (FIBS formula; instant forfeits never count).
 * Sets each row's ratingChange and applies it to the accounts.
 */
export async function applyRatings(t: Tx, rec: MatchRecord, rows: MatchResultRow[]) {
  if (rec.chess) return applyChessRatings(t, rec, rows);
  if (!rec.ranked || rows.length !== 2 || !rec.state.results.some((r) => r.kind !== "forfeit")) return rows;
  const winRow = rows.find((r) => r.won);
  const loseRow = rows.find((r) => !r.won);
  if (!winRow || !loseRow) return rows;
  const users = await t.users.getMany([winRow.userId, loseRow.userId]);
  const w = users[winRow.userId];
  const l = users[loseRow.userId];
  if (!w || !l) return rows;
  const n = rec.state.targetPoints;
  const [gain, loss] = ratingChange(
    { rating: w.rating ?? START_RATING, experience: w.ratingExperience ?? 0 },
    { rating: l.rating ?? START_RATING, experience: l.ratingExperience ?? 0 },
    n,
  );
  winRow.ratingChange = Math.round(gain * 100) / 100;
  loseRow.ratingChange = -Math.round(loss * 100) / 100;
  await t.users.applyRating(w.id, winRow.ratingChange, n);
  await t.users.applyRating(l.id, loseRow.ratingChange, n);
  return rows;
}

/** Rated chess games move both Elo ratings (draws count half); games where someone never moved don't. */
async function applyChessRatings(t: Tx, rec: MatchRecord, rows: MatchResultRow[]) {
  if (!rec.ranked || rows.length !== 2 || rec.chess!.moves.length < 2) return rows;
  const stats = await t.gameStats.getMany([rows[0].userId, rows[1].userId], "chess");
  const s = (id: string) => stats[id] ?? { rating: START_RATING, ratingGames: 0 };
  const [a, b] = rows;
  const scoreA = rec.state.winner === null ? 0.5 : a.won ? 1 : 0;
  const da = eloChange(s(a.userId).rating, s(b.userId).rating, scoreA, s(a.userId).ratingGames);
  const db = eloChange(s(b.userId).rating, s(a.userId).rating, (1 - scoreA) as 0 | 0.5 | 1, s(b.userId).ratingGames);
  a.ratingChange = Math.round(da * 100) / 100;
  b.ratingChange = Math.round(db * 100) / 100;
  await t.gameStats.applyRating(a.userId, "chess", a.ratingChange, 1);
  await t.gameStats.applyRating(b.userId, "chess", b.ratingChange, 1);
  return rows;
}

export function periodRange(period: "week" | "season", now: number) {
  if (period === "week") {
    const since = Date.parse(`${weekKey(now)}T00:00:00Z`);
    return { since, until: since + WEEK };
  }
  const d = new Date(now);
  return { since: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), until: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/** Prize amounts per place; when the split adds up to 100%, rounding leftovers go to first place. */
export function prizeSplit(units: number, split: number[]) {
  const places = split.map((pct) => Math.floor((units * pct) / 100));
  if (places.length && split.reduce((a, b) => a + b, 0) === 100) places[0] += units - places.reduce((a, b) => a + b, 0);
  return places;
}

export function leaderboard(userId: string | null, period: "week" | "season", now = Date.now()) {
  return tx(async (t) => {
    const { since, until } = periodRange(period, now);
    const settings = await operatorSettings(t);
    const pool = settings.prizePool;
    const rows = await t.results.leaderboard(since, until, 50);
    const users = await t.users.getMany(rows.map((r) => r.userId).concat(userId ? [userId] : []));
    const eligible = (id: string, opponents: number) => !!users[id]?.walletAddress && !isSuspended(users[id]) && opponents >= pool.minOpponents;
    const prizeOn = period === "week" && pool.enabled && pool.units > 0;
    const amounts = prizeOn ? prizeSplit(pool.units, pool.split) : [];
    // Prize places go to the best eligible players, in order.
    let place = 0;
    const list = rows.map((r, i) => {
      const ok = eligible(r.userId, r.opponents);
      const prizePlace = prizeOn && ok && place < amounts.length ? ++place : null;
      const u = users[r.userId];
      return {
        rank: i + 1,
        name: u?.name ?? "Player",
        avatarUrl: avatarUrl(u),
        frame: u?.frame ?? "none",
        level: levelOf(u?.xp ?? 0).level,
        points: r.points,
        wins: r.wins,
        played: r.played,
        me: r.userId === userId,
        eligible: ok,
        prize: prizePlace ? amounts[prizePlace - 1] : null,
      };
    });
    const me = userId ? await t.results.standing(userId, since, until) : null;
    const last = period === "week" ? (await t.prizes.list(4)).find((w) => w.status === "PAID") : undefined;
    return {
      period,
      since: new Date(since).toISOString(),
      endsAt: new Date(until).toISOString(),
      rows: list,
      me: me && userId ? { ...me, eligible: eligible(userId, me.opponents), registered: !!users[userId]?.walletAddress } : null,
      prize: prizeOn ? { units: pool.units, places: amounts, minOpponents: pool.minOpponents } : null,
      lastWinners: last ? { weekKey: last.weekKey, winners: last.winners.map(({ name, place, points, units }) => ({ name, place, points, units })) } : null,
      points: POINTS,
    };
  });
}

export type Leaderboard = Awaited<ReturnType<typeof leaderboard>>;

/** Players by rating (at least one ranked match), with your own position. */
export function ratingBoard(userId: string | null) {
  return tx(async (t) => {
    const top = await t.users.topRated(1, 50);
    const me = userId ? await t.users.get(userId) : undefined;
    const myGames = me?.ratingGames ?? 0;
    return {
      rows: top.map((u, i) => ({
        rank: i + 1,
        name: u.name,
        avatarUrl: avatarUrl(u),
        frame: u.frame ?? "none",
        level: levelOf(u.xp ?? 0).level,
        rating: Math.round(u.rating ?? START_RATING),
        games: u.ratingGames ?? 0,
        provisional: (u.ratingGames ?? 0) < PROVISIONAL_GAMES,
        me: u.id === userId,
      })),
      me: me
        ? {
            rating: Math.round(me.rating ?? START_RATING),
            games: myGames,
            provisional: myGames < PROVISIONAL_GAMES,
            rank: myGames > 0 ? (await t.users.countRatedAbove(me.rating ?? START_RATING, 1)) + 1 : null,
          }
        : null,
    };
  });
}

export type RatingBoard = Awaited<ReturnType<typeof ratingBoard>>;

/**
 * After a week ends, record its proposed winners for an admin to check (once). Players under review
 * (flagged results) don't count until cleared.
 */
export async function closeWeek(now = Date.now()) {
  const key = weekKey(now - WEEK);
  return tx(async (t) => {
    if (await t.prizes.get(key)) return null;
    const pool = (await operatorSettings(t)).prizePool;
    const since = Date.parse(`${key}T00:00:00Z`);
    const rows = await t.results.leaderboard(since, since + WEEK, 200);
    const users = await t.users.getMany(rows.map((r) => r.userId));
    const amounts = pool.enabled ? prizeSplit(pool.units, pool.split) : [];
    const winners = rows
      .filter((r) => users[r.userId]?.walletAddress && !isSuspended(users[r.userId]) && r.opponents >= pool.minOpponents)
      .slice(0, amounts.length)
      .map((r, i) => ({ userId: r.userId, name: users[r.userId].name, place: i + 1, points: r.points, units: amounts[i] }));
    const week: PrizeWeek = {
      weekKey: key,
      status: winners.length ? "PENDING_REVIEW" : "SKIPPED",
      poolUnits: pool.enabled ? pool.units : 0,
      winners,
      createdAt: new Date(now).toISOString(),
      note: winners.length ? undefined : pool.enabled ? "No eligible players" : "Prize pool off",
    };
    await t.prizes.put(week);
    return week;
  });
}

/** Admin: pay a week's winners (into their token balance) or skip the week. */
export async function decidePrizeWeekIn(t: Tx, weekKeyStr: string, approve: boolean, by: string, note?: string) {
  const w = await t.prizes.get(weekKeyStr, { lock: true });
  if (!w) throw notFound("Prize week");
  if (w.status !== "PENDING_REVIEW") throw new ApiError(409, "WRONG_PHASE", "This week was already decided");
  if (approve) {
    for (const win of w.winners) {
      await post(
        t,
        `prize:${w.weekKey}:${win.userId}`,
        "PRIZE",
        [
          { account: SYSTEM.prizes, amount: -win.units },
          { account: userAccount(win.userId, "PAID_AVAILABLE"), amount: win.units },
        ],
        `Weekly prize, place ${win.place} (week of ${w.weekKey})`,
      );
    }
  }
  const decided: PrizeWeek = { ...w, status: approve ? "PAID" : "SKIPPED", decidedBy: by, decidedAt: new Date().toISOString(), note: note ?? w.note };
  await t.prizes.put(decided);
  return decided;
}
