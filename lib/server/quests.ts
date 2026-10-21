import type { Seat } from "../engine/board";
import { MATCH_XP, QUESTS, activeQuests, frameUnlocked, levelOf, periodEnds, periodKey, type QuestMetric } from "../quests";
import { ApiError, notFound } from "./errors";
import { post, userAccount, SYSTEM } from "./ledger";
import { accountXp } from "./stats";
import { tx, type MatchRecord, type Tx } from "./store";

/**
 * Quest progress and XP. Called for every saved match change with only the events added by that
 * change, so each turn or result is counted exactly once.
 */
const BOT = "bot";
/** Online wins against the same opponent count toward quests at most this often per day. */
export const SAME_OPPONENT_DAILY_CAP = 3;

/** A match "really" won: at least one game was played to the end (not an instant forfeit). */
const realWin = (rec: MatchRecord) => rec.state.results.some((r) => r.kind !== "forfeit");

export async function recordProgress(t: Tx, rec: MatchRecord) {
  if (rec.mode === "local" || rec.events.length === 0) return;
  const counts: Record<string, Partial<Record<QuestMetric, number>>> = {};
  const add = (seat: number, m: QuestMetric, n = 1) => {
    const id = rec.seats[seat];
    if (!id || id === BOT) return;
    (counts[id] ??= {})[m] = (counts[id][m] ?? 0) + n;
  };
  const online = rec.mode === "quick" || rec.mode === "private";
  const finished = rec.events.some((e) => e.type === "MATCH_COMPLETED");
  // A win counts when a game was really played (not an instant forfeit; in chess, both sides moved).
  const real = rec.chess ? rec.chess.moves.length >= 2 : realWin(rec);
  if (!rec.chess) {
    for (const e of rec.events) {
      const p = e.payload;
      if (e.type === "TURN_COMMITTED") {
        const hits = ((p.moves as { hit?: boolean }[]) ?? []).filter((m) => m.hit).length;
        if (hits) add(Number(p.seat), "hits", hits);
      } else if (e.type === "GAME_COMPLETED") {
        const kind = String(p.kind);
        if (kind === "single" || kind === "gammon" || kind === "backgammon") add(Number(p.winner), "bearOffWins");
        if (kind === "gammon" || kind === "backgammon") add(Number(p.winner), "gammonWins");
      }
    }
  }
  if (finished) {
    for (const seat of [0, 1] as Seat[]) {
      add(seat, "matchesPlayed");
      if (online) add(seat, "onlinePlayed");
      if (rec.mode === "bot") add(seat, "computerPlayed");
      if (rec.chess) add(seat, "chessPlayed");
      if (rec.state.winner === seat && real) {
        add(seat, "wins");
        if (online) add(seat, "onlineWins");
        if (!rec.chess && rec.state.targetPoints >= 5) add(seat, "longMatchWins");
        if (rec.chess?.result?.reason === "checkmate") add(seat, "checkmateWins");
      }
    }
  }
  const now = Date.now();
  const game = rec.gameType ?? "backgammon";
  for (const [userId, c] of Object.entries(counts)) {
    // Repeated online wins over the same opponent stop counting after a few a day (anti-farming).
    if (finished && online && c.onlineWins) {
      const opp = rec.seats.find((s) => s !== userId);
      const today = await t.results.countAgainst(userId, opp ?? "", now - (now % 86_400_000));
      if (today > SAME_OPPONENT_DAILY_CAP) {
        delete c.onlineWins;
        delete c.wins;
        delete c.longMatchWins;
        delete c.checkmateWins;
      }
    }
    const rows = (["daily", "weekly"] as const).flatMap((period) =>
      activeQuests(period, now)
        .filter((q) => c[q.metric] && (!q.game || q.game === game))
        .map((q) => ({ periodKey: periodKey(period, now), questId: q.id, n: c[q.metric]!, target: q.target })),
    );
    await t.quests.bump(userId, rows);
    if (finished) {
      const seat = rec.seats.indexOf(userId);
      await t.gameStats.addXp(userId, game, MATCH_XP.played + (rec.state.winner === seat && real ? MATCH_XP.won : 0));
    }
  }
}

/** This period's quests with the player's progress, plus their level. */
export function questBoard(userId: string, now = Date.now()) {
  return tx(async (t) => {
    const user = await t.users.get(userId);
    if (!user) throw notFound("Player");
    const keys = { daily: periodKey("daily", now), weekly: periodKey("weekly", now) };
    const rows = await t.quests.list(userId, [keys.daily, keys.weekly]);
    const view = (period: "daily" | "weekly") =>
      activeQuests(period, now).map((q) => {
        const r = rows.find((x) => x.periodKey === keys[period] && x.questId === q.id);
        return { ...q, progress: r?.progress ?? 0, claimed: !!r?.claimedAt, endsAt: new Date(periodEnds(period, now)).toISOString() };
      });
    const xp = await accountXp(t, userId);
    return {
      daily: view("daily"),
      weekly: view("weekly"),
      xp,
      ...levelOf(xp),
      frame: user.frame ?? "none",
      registered: !!user.walletAddress,
    };
  });
}

export type QuestBoard = Awaited<ReturnType<typeof questBoard>>;

/** Claim a completed quest: XP for everyone, practice credits for wallet accounts. */
export async function claimQuest(userId: string, questId: unknown, now = Date.now()) {
  const q = QUESTS.find((x) => x.id === questId);
  if (!q || !activeQuests(q.period, now).some((x) => x.id === q.id)) throw new ApiError(400, "INVALID_INPUT", "That quest is not active");
  return tx(async (t) => {
    const key = periodKey(q.period, now);
    if (!(await t.quests.claim(userId, key, q.id, q.target))) throw new ApiError(409, "WRONG_PHASE", "This quest is not complete yet, or was already claimed");
    // Game quests feed that game's level; general quests the Arena pool. Both raise the Arena level.
    const before = levelOf(await accountXp(t, userId)).level;
    await t.gameStats.addXp(userId, q.game ?? "arena", q.xp);
    const xp = await accountXp(t, userId);
    const user = await t.users.get(userId);
    let credits = 0;
    if (user?.walletAddress && q.credits > 0) {
      await post(
        t,
        `quest:${userId}:${key}:${q.id}`,
        "QUEST_REWARD",
        [
          { account: SYSTEM.freeIssuance, amount: -q.credits },
          { account: userAccount(userId, "FREE_CREDITS"), amount: q.credits },
        ],
        `Quest reward: ${q.title}`,
      );
      credits = q.credits;
    }
    const after = levelOf(xp);
    return { xp, ...after, levelUp: after.level > before, credits };
  });
}

/** Choose an avatar frame unlocked by the player's level. */
export function setFrame(userId: string, frame: unknown) {
  return tx(async (t) => {
    const user = await t.users.get(userId);
    if (!user) throw notFound("Player");
    const id = typeof frame === "string" ? frame : "";
    if (!frameUnlocked(id, levelOf(await accountXp(t, userId)).level)) throw new ApiError(403, "INELIGIBLE", "Reach a higher level to unlock this frame");
    await t.users.put({ ...user, frame: id });
    return { frame: id };
  });
}
