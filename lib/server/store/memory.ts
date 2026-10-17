import fs from "node:fs";
import path from "node:path";
import { lobbyRow } from "./summary";
import {
  SPECTATOR_WINDOW_MS,
  type Adjustment,
  type AdminChallenge,
  type AdminRole,
  type AdminSession,
  type Announcement,
  type AppError,
  type AuditEntry,
  type ChatMessage,
  type DepositIntent,
  type Dispute,
  type DisputeNote,
  type MatchRecord,
  type MatchResultRow,
  type PrizeWeek,
  type Session,
  type StoredEvent,
  type Store,
  type Tx,
  type Txn,
  type User,
  type UserRow,
  type Withdrawal,
} from "./types";

interface RoleRecord {
  id: string;
  userId: string;
  role: AdminRole;
  grantedBy?: string;
  grantedAt: string;
  revokedBy?: string;
  revokedAt?: string;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function daily(days: number, stamps: number[]) {
  const today = Date.parse(`${dayKey(Date.now())}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(today - (days - 1 - i) * 86_400_000);
    return { day, n: stamps.filter((s) => dayKey(s) === day).length };
  });
}

/**
 * Local development store: one JSON document on disk (or in memory for tests). Transactions are
 * serialised by a mutex; writes are buffered and applied only on commit, so a thrown error leaves
 * nothing behind. Single process only — use Postgres (DATABASE_URL) for anything deployed.
 */
interface Data {
  users: Record<string, User>;
  sessions: Record<string, Session>;
  matches: Record<string, MatchRecord>;
  idempotency: Record<string, { fingerprint: string; response: unknown }>;
  deposits: Record<string, DepositIntent>;
  withdrawals: Record<string, Withdrawal>;
  paymentEvents: Record<string, { outcome: string }>;
  avatars: Record<string, { file: string; userId: string; contentType: string; b64: string }>;
  presence: Record<string, [number, number]>;
  disputes: Record<string, Dispute>;
  seen: Record<string, number>;
  spectators: Record<string, Record<string, number>>;
  adminRoles: Record<string, RoleRecord>;
  adminSessions: Record<string, AdminSession>;
  adminChallenges: Record<string, AdminChallenge>;
  audit: Record<string, AuditEntry>;
  settings: Record<string, unknown>;
  announcements: Record<string, Announcement>;
  disputeNotes: Record<string, DisputeNote>;
  adjustments: Record<string, Adjustment>;
  matchEvents: Record<string, StoredEvent[]>;
  matchActions: Record<string, { fingerprint: string; response: unknown }>;
  results: Record<string, MatchResultRow>;
  counters: Record<string, number>;
  rateLimits: Record<string, { start: number; count: number }>;
  chat: Record<string, ChatMessage>;
  errors: Record<string, AppError>;
  quests: Record<string, { userId: string; periodKey: string; questId: string; progress: number; claimedAt?: string }>;
  prizes: Record<string, PrizeWeek>;
  ledger: { balances: Record<string, number>; transactions: Txn[] };
}

type Coll = Exclude<keyof Data, "ledger">;
const DELETED = Symbol("deleted");

const empty = (): Data => ({
  users: {},
  sessions: {},
  matches: {},
  idempotency: {},
  deposits: {},
  withdrawals: {},
  paymentEvents: {},
  avatars: {},
  presence: {},
  disputes: {},
  seen: {},
  spectators: {},
  adminRoles: {},
  adminSessions: {},
  adminChallenges: {},
  audit: {},
  settings: {},
  announcements: {},
  disputeNotes: {},
  adjustments: {},
  matchEvents: {},
  matchActions: {},
  results: {},
  counters: {},
  rateLimits: {},
  chat: {},
  errors: {},
  quests: {},
  prizes: {},
  ledger: { balances: {}, transactions: [] },
});

export function createMemoryStore(file: string | null): Store {
  const g = globalThis as unknown as { __bgMem?: Record<string, Data> };
  g.__bgMem ??= {};
  const cacheKey = file ?? ":memory:";
  let chain: Promise<unknown> = Promise.resolve();

  const load = (): Data => {
    if (g.__bgMem![cacheKey]) return g.__bgMem![cacheKey];
    let data = empty();
    if (file && fs.existsSync(/*turbopackIgnore: true*/ file)) {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
      // Files from before the store refactor used a different shape; start fresh rather than misread them.
      if (parsed && parsed.ledger && Array.isArray(parsed.ledger.transactions) && parsed.avatars) data = { ...data, ...parsed };
      data.presence ??= {};
      data.disputes ??= {};
      data.seen ??= {};
      data.spectators ??= {};
      for (const k of [
        "adminRoles",
        "adminSessions",
        "adminChallenges",
        "audit",
        "settings",
        "announcements",
        "disputeNotes",
        "adjustments",
        "matchEvents",
        "matchActions",
        "results",
        "counters",
        "rateLimits",
        "chat",
        "errors",
        "quests",
        "prizes",
      ] as const) {
        (data as unknown as Record<string, object>)[k] ??= {};
      }
    }
    g.__bgMem![cacheKey] = data;
    return data;
  };
  const save = (data: Data) => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };

  async function run<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
    const base = load();
    const pending: { [K in Coll]?: Map<string, unknown> } = {};
    const pendingTxns: Txn[] = [];
    const pendingBalances: Record<string, number> = {};
    const clone = <V>(v: V): V => structuredClone(v);

    const getRaw = <V>(c: Coll, id: string): V | undefined => {
      const p = pending[c]?.get(id);
      if (p === DELETED) return undefined;
      if (p !== undefined) return p as V;
      return (base[c] as Record<string, V>)[id];
    };
    const get = <V>(c: Coll, id: string) => {
      const v = getRaw<V>(c, id);
      return v === undefined ? undefined : clone(v);
    };
    const put = (c: Coll, id: string, v: unknown) => {
      (pending[c] ??= new Map()).set(id, clone(v));
    };
    const del = (c: Coll, id: string) => {
      (pending[c] ??= new Map()).set(id, DELETED);
    };
    const values = <V>(c: Coll): V[] => {
      const ids = new Set([...Object.keys(base[c]), ...(pending[c]?.keys() ?? [])]);
      return [...ids]
        .map((id) => getRaw<V>(c, id))
        .filter((v): v is V => v !== undefined)
        .map(clone);
    };
    const row = (m: MatchRecord, spectatorsSince: number) =>
      lobbyRow(
        m,
        get<[number, number]>("presence", m.id)?.[0] ?? 0,
        Object.values(get<Record<string, number>>("spectators", m.id) ?? {}).filter((v) => v >= spectatorsSince).length,
      );
    /** Leaderboard totals in [since, until), best first (same order as the Postgres query). */
    const totals = (since: number, until: number) => {
      const by = new Map<string, { userId: string; points: number; wins: number; played: number; opp: Set<string>; first: number }>();
      for (const r of values<MatchResultRow>("results")) {
        const at = Date.parse(r.completedAt);
        if (at < since || at >= until || !r.opponentId || r.flagged) continue;
        const cur = by.get(r.userId) ?? { userId: r.userId, points: 0, wins: 0, played: 0, opp: new Set<string>(), first: at };
        cur.points += r.lbPoints ?? 0;
        cur.wins += r.won ? 1 : 0;
        cur.played += 1;
        cur.opp.add(r.opponentId);
        cur.first = Math.min(cur.first, at);
        by.set(r.userId, cur);
      }
      return [...by.values()]
        .filter((x) => x.points > 0)
        .sort((a, b) => b.points - a.points || b.wins - a.wins || a.first - b.first)
        .map(({ userId, points, wins, played, opp }) => ({ userId, points, wins, played, opponents: opp.size }));
    };
    const allTxns = () => [...base.ledger.transactions, ...pendingTxns];
    const balance = (a: string) => pendingBalances[a] ?? base.ledger.balances[a] ?? 0;

    const committed: (() => void)[] = [];
    const t: Tx = {
      lock: async () => {},
      afterCommit: (fn) => {
        committed.push(fn);
      },
      users: {
        get: async (id) => get("users", id),
        getMany: async (ids) => Object.fromEntries(ids.map((id) => [id, get<User>("users", id)]).filter(([, u]) => u)),
        byWallet: async (address) => values<User>("users").find((u) => u.walletAddress?.toLowerCase() === address.toLowerCase()),
        put: async (u) => put("users", u.id, u),
        count: async () => values("users").length,
        touchSeen: async (id, at) => put("seen", id, Math.max(get<number>("seen", id) ?? 0, at)),
        addXp: async (id, n) => {
          const u = get<User>("users", id);
          if (!u) return 0;
          const xp = (u.xp ?? 0) + n;
          put("users", id, { ...u, xp });
          return xp;
        },
        markAway: async (id, at) => put("seen", id, Math.min(get<number>("seen", id) ?? at, at)),
        countSeenSince: async (at) => values<number>("seen").filter((v) => v >= at).length,
        deleteInactiveGuests: async (before, limit) => {
          const matches = values<MatchRecord>("matches");
          const guests = values<User>("users")
            .filter((u) => !u.walletAddress)
            .filter((u) => (get<number>("seen", u.id) ?? Date.parse(u.createdAt)) < before)
            .filter(
              (u) =>
                !matches.some(
                  (m) =>
                    (m.mode === "quick" || m.mode === "private") && (m.state.status === "WAITING" || m.state.status === "ACTIVE") && m.seats.includes(u.id),
                ),
            )
            .slice(0, limit);
          for (const u of guests) {
            for (const m of matches.filter((m) => m.seats[0] === u.id && (m.mode === "local" || m.mode === "bot" || m.seats[1] === null))) {
              for (const c of ["matches", "matchEvents", "presence", "spectators"] as const) del(c, m.id);
              for (const k of Object.keys(base.matchActions)) if (k.startsWith(`${m.id}:`)) del("matchActions", k);
            }
            for (const r of values<MatchResultRow>("results").filter((r) => r.userId === u.id)) del("results", `${r.matchId}:${r.userId}`);
            for (const d of values<Dispute>("disputes").filter((d) => d.userId === u.id)) del("disputes", d.id);
            for (const [token, sess] of Object.entries(base.sessions)) if (sess.userId === u.id) del("sessions", token);
            del("seen", u.id);
            del("users", u.id);
          }
          return guests.length;
        },
        search: async (query, limit) => {
          const q = query.trim().toLowerCase();
          return values<User>("users")
            .filter((u) => !q || u.id === q || u.name.toLowerCase().includes(q) || (u.walletAddress ?? "").toLowerCase().includes(q))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((u): UserRow => {
              const seenAt = get<number>("seen", u.id);
              return { ...u, lastSeenAt: seenAt ? new Date(seenAt).toISOString() : undefined };
            });
        },
        countCreatedSince: async (at) => values<User>("users").filter((u) => Date.parse(u.createdAt) >= at).length,
        countRegistered: async () => values<User>("users").filter((u) => u.walletAddress).length,
        dailyNew: async (days) =>
          daily(
            days,
            values<User>("users").map((u) => Date.parse(u.createdAt)),
          ),
      },
      sessions: {
        get: async (token) => get("sessions", token),
        put: async (token, s) => put("sessions", token, s),
        delete: async (token) => del("sessions", token),
        deleteForUser: async (userId) => {
          const ids = Object.keys(base.sessions)
            .concat([...(pending.sessions?.keys() ?? [])])
            .filter((token) => get<Session>("sessions", token)?.userId === userId);
          for (const token of new Set(ids)) del("sessions", token);
          return new Set(ids).size;
        },
      },
      matches: {
        get: async (id) => {
          const m = get<MatchRecord>("matches", id);
          return m && { ...m, events: [], actions: {} };
        },
        put: async (rec) => {
          put("matches", rec.id, { ...rec, events: [], actions: {} });
          if (rec.events.length) {
            const log = get<StoredEvent[]>("matchEvents", rec.id) ?? [];
            const last = log[log.length - 1]?.seq ?? 0;
            put("matchEvents", rec.id, [...log, ...rec.events.filter((e) => e.seq > last)]);
          }
          for (const [actionId, a] of Object.entries(rec.actions)) {
            if (!getRaw("matchActions", `${rec.id}:${actionId}`)) put("matchActions", `${rec.id}:${actionId}`, a);
          }
        },
        events: async (id, f) => {
          const log = (get<StoredEvent[]>("matchEvents", id) ?? []).filter((e) => e.seq > (f.after ?? 0));
          return f.last !== undefined ? log.slice(-f.last) : log;
        },
        action: async (id, actionId) => get("matchActions", `${id}:${actionId}`),
        listOpen: async (userId, limit) => {
          const since = Date.now() - SPECTATOR_WINDOW_MS;
          return values<MatchRecord>("matches")
            .filter((m) => m.seats.includes(userId) && (m.state.status === "WAITING" || m.state.status === "ACTIVE"))
            .map((m) => row(m, since))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit);
        },
        staleTables: async (f) =>
          values<MatchRecord>("matches")
            .filter((m) => {
              if (m.state.status !== "WAITING") return false;
              const created = Date.parse(m.createdAt);
              if (m.mode === "private") return created < f.privateBefore;
              if (m.mode !== "quick") return false;
              const seen = get<[number, number]>("presence", m.id)?.[0] || created;
              return seen < f.hostSeenBefore || created < f.publicBefore;
            })
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .slice(0, f.limit)
            .map((m) => m.id),
        idleActive: async (f) =>
          values<MatchRecord>("matches")
            .filter((m) => {
              if (m.state.status !== "ACTIVE") return false;
              const at = m.updatedAt ?? 0;
              if (m.mode === "bot" || m.mode === "local") return at < f.offlineBefore;
              const seen = get<[number, number]>("presence", m.id) ?? [0, 0];
              return at < f.onlineBefore && seen.filter((s) => s >= f.awayBefore).length < 2;
            })
            .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
            .slice(0, f.limit)
            .map((m) => m.id),
        countActiveSince: async (since) => values<MatchRecord>("matches").filter((m) => m.state.status === "ACTIVE" && (m.updatedAt ?? 0) >= since).length,
        listPublic: async (f) => {
          const since = Date.now() - SPECTATOR_WINDOW_MS;
          const all = values<MatchRecord>("matches")
            .filter((m) => m.mode === "quick" && m.state.status === f.status)
            .map((m) => row(m, since))
            .filter(
              (r) =>
                (f.status === "WAITING" ? r.hostSeenAt >= f.hostSeenSince : r.allowSpectators && r.updatedAt >= f.activeSince) &&
                (!f.points || r.targetPoints === f.points) &&
                (f.feeMin === undefined || r.entryFee >= f.feeMin) &&
                (f.feeMax === undefined || r.entryFee <= f.feeMax),
            )
            .sort((a, b) => (f.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
          return { rows: all.slice(f.offset, f.offset + f.limit), total: all.length };
        },
        listAdmin: async (f) => {
          const since = Date.now() - SPECTATOR_WINDOW_MS;
          return values<MatchRecord>("matches")
            .filter((m) => (!f.status || m.state.status === f.status) && (!f.userId || m.seats.includes(f.userId)))
            .map((m) => row(m, since))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, f.limit);
        },
        countCompletedSince: async (at) => values<MatchRecord>("matches").filter((m) => m.completedAt && Date.parse(m.completedAt) >= at).length,
        dailyCompleted: async (days) =>
          daily(
            days,
            values<MatchRecord>("matches")
              .filter((m) => m.completedAt)
              .map((m) => Date.parse(m.completedAt!)),
          ),
      },
      results: {
        put: async (rows) => {
          for (const r of rows) if (!getRaw("results", `${r.matchId}:${r.userId}`)) put("results", `${r.matchId}:${r.userId}`, r);
        },
        deleteForMatch: async (matchId) => {
          const rows = values<MatchResultRow>("results").filter((r) => r.matchId === matchId);
          for (const r of rows) del("results", `${r.matchId}:${r.userId}`);
          return rows.map((r) => r.userId);
        },
        stats: async (userId, since) => {
          const mine = values<MatchResultRow>("results")
            .filter((r) => r.userId === userId && (since === undefined || Date.parse(r.completedAt) >= since))
            .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
          let streak = 0,
            best = 0;
          for (const r of mine) {
            streak = r.won ? streak + 1 : 0;
            best = Math.max(best, streak);
          }
          const sum = (k: "points" | "games" | "gammons") => mine.reduce((n, r) => n + r[k], 0);
          return {
            played: mine.length,
            wins: mine.filter((r) => r.won).length,
            points: sum("points"),
            games: sum("games"),
            gammons: sum("gammons"),
            currentStreak: streak,
            bestStreak: best,
          };
        },
        countAgainst: async (userId, opponentId, since, opts) =>
          values<MatchResultRow>("results").filter(
            (r) => r.userId === userId && r.opponentId === opponentId && (opts?.played || r.won) && Date.parse(r.completedAt) >= since,
          ).length,
        leaderboard: async (since, until, limit) => totals(since, until).slice(0, limit),
        standing: async (userId, since, until) => {
          const all = totals(since, until);
          const i = all.findIndex((r) => r.userId === userId);
          return i >= 0 ? { ...all[i], rank: i + 1 } : { userId, points: 0, wins: 0, played: 0, opponents: 0, rank: null };
        },
        setFlagged: async (matchId, flagged) => {
          for (const r of values<MatchResultRow>("results").filter((r) => r.matchId === matchId)) put("results", `${r.matchId}:${r.userId}`, { ...r, flagged });
        },
        history: async (userId, offset, limit) =>
          values<MatchResultRow>("results")
            .filter((r) => r.userId === userId)
            .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
            .slice(offset, offset + limit),
      },
      chat: {
        add: async (m) => {
          const msg: ChatMessage = { ...m, id: values("chat").length + 1, createdAt: new Date().toISOString() };
          put("chat", String(msg.id), msg);
          return msg;
        },
        list: async (matchId, after, limit) =>
          values<ChatMessage>("chat")
            .filter((m) => m.matchId === matchId && m.id > after)
            .sort((a, b) => a.id - b.id)
            .slice(-limit),
        get: async (id) => get("chat", String(id)),
        remove: async (id, by) => {
          const m = get<ChatMessage>("chat", String(id));
          if (m && !m.removedAt) put("chat", String(id), { ...m, removedAt: new Date().toISOString(), removedBy: by });
        },
      },
      errors: {
        add: async (e) => {
          const id = values("errors").length + 1;
          put("errors", String(id), { ...e, id, createdAt: new Date().toISOString() });
        },
        recent: async (limit) =>
          values<AppError>("errors")
            .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
            .slice(0, limit),
        countSince: async (at) => values<AppError>("errors").filter((e) => Date.parse(e.createdAt) >= at).length,
        prune: async (before) => {
          for (const e of values<AppError>("errors")) if (Date.parse(e.createdAt) < before) del("errors", String(e.id));
        },
      },
      rateLimits: {
        hit: async (key, start) => {
          const cur = get<{ start: number; count: number }>("rateLimits", key);
          const next = { start, count: cur && cur.start === start ? cur.count + 1 : 1 };
          put("rateLimits", key, next);
          return next.count;
        },
        prune: async (before) => {
          for (const [k, v] of Object.entries(base.rateLimits)) if (v.start < before) del("rateLimits", k);
        },
      },
      quests: {
        list: async (userId, keys) =>
          values<Data["quests"][string]>("quests")
            .filter((r) => r.userId === userId && keys.includes(r.periodKey))
            .map(({ periodKey, questId, progress, claimedAt }) => ({ periodKey, questId, progress, claimedAt })),
        bump: async (userId, rows) => {
          for (const r of rows) {
            const k = `${userId}|${r.periodKey}|${r.questId}`;
            const cur = get<Data["quests"][string]>("quests", k);
            if (cur?.claimedAt) continue;
            put("quests", k, { userId, periodKey: r.periodKey, questId: r.questId, progress: Math.min(r.target, (cur?.progress ?? 0) + r.n) });
          }
        },
        claim: async (userId, periodKey, questId, target) => {
          const k = `${userId}|${periodKey}|${questId}`;
          const cur = get<Data["quests"][string]>("quests", k);
          if (!cur || cur.claimedAt || cur.progress < target) return false;
          put("quests", k, { ...cur, claimedAt: new Date().toISOString() });
          return true;
        },
      },
      prizes: {
        get: async (weekKey) => get("prizes", weekKey),
        put: async (w) => put("prizes", w.weekKey, w),
        list: async (limit) =>
          values<PrizeWeek>("prizes")
            .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
            .slice(0, limit),
      },
      counters: {
        add: async (key, n) => put("counters", key, (get<number>("counters", key) ?? 0) + n),
        get: async (keys) => Object.fromEntries(keys.map((k) => [k, get<number>("counters", k) ?? 0])),
      },
      idempotency: {
        get: async (key) => get("idempotency", key),
        put: async (key, v) => put("idempotency", key, v),
      },
      deposits: {
        get: async (id) => get("deposits", id),
        byRef: async (ref) => values<DepositIntent>("deposits").find((d) => d.externalRef === ref),
        put: async (d) => put("deposits", d.id, d),
        listByUser: async (userId) =>
          values<DepositIntent>("deposits")
            .filter((d) => d.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        listAll: async (f) =>
          values<DepositIntent>("deposits")
            .filter((d) => !f.status || d.status === f.status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, f.limit),
      },
      withdrawals: {
        get: async (id) => get("withdrawals", id),
        byRef: async (ref) => values<Withdrawal>("withdrawals").find((w) => w.externalRef === ref),
        put: async (w) => put("withdrawals", w.id, w),
        listByUser: async (userId) =>
          values<Withdrawal>("withdrawals")
            .filter((w) => w.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        listAll: async (f) =>
          values<Withdrawal>("withdrawals")
            .filter((w) => !f.status || w.status === f.status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, f.limit),
      },
      paymentEvents: {
        get: async (id) => get("paymentEvents", id),
        put: async (id, outcome) => put("paymentEvents", id, { outcome }),
      },
      ledger: {
        balances: async (accounts) => Object.fromEntries(accounts.map((a) => [a, balance(a)])),
        txnByKey: async (key) => {
          const txn = allTxns().find((x) => x.key === key);
          return txn && clone(txn);
        },
        insert: async (txn, next) => {
          const full: Txn = { ...clone(txn), id: `txn_${allTxns().length + 1}` };
          pendingTxns.push(full);
          Object.assign(pendingBalances, next);
          return clone(full);
        },
        userTransactions: async (userId, limit) => {
          const prefix = `user:${userId}:`;
          return allTxns()
            .filter((x) => x.entries.some((e) => e.account.startsWith(prefix)))
            .reverse()
            .slice(0, limit)
            .map(clone);
        },
        dump: async () => ({
          transactions: allTxns().map(clone),
          balances: { ...base.ledger.balances, ...pendingBalances },
        }),
      },
      avatars: {
        put: async (a) => put("avatars", a.file, { file: a.file, userId: a.userId, contentType: a.contentType, b64: Buffer.from(a.bytes).toString("base64") }),
        get: async (file) => {
          const a = get<Data["avatars"][string]>("avatars", file);
          return a && { file: a.file, userId: a.userId, contentType: a.contentType, bytes: new Uint8Array(Buffer.from(a.b64, "base64")) };
        },
        delete: async (file) => del("avatars", file),
      },
      presence: {
        touch: async (matchId, seat, at) => {
          const cur = get<[number, number]>("presence", matchId) ?? [0, 0];
          cur[seat] = Math.max(cur[seat], at);
          put("presence", matchId, cur);
        },
        get: async (matchId) => get<[number, number]>("presence", matchId) ?? [0, 0],
      },
      spectators: {
        touch: async (matchId, userId, at) => {
          const cur = get<Record<string, number>>("spectators", matchId) ?? {};
          cur[userId] = Math.max(cur[userId] ?? 0, at);
          put("spectators", matchId, cur);
        },
        count: async (matchId, since) => Object.values(get<Record<string, number>>("spectators", matchId) ?? {}).filter((v) => v >= since).length,
      },
      disputes: {
        put: async (d) => put("disputes", d.id, d),
        listByUser: async (userId) =>
          values<Dispute>("disputes")
            .filter((d) => d.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        get: async (id) => get("disputes", id),
        update: async (d) => put("disputes", d.id, d),
        listAll: async (f) =>
          values<Dispute>("disputes")
            .filter((d) => !f.status || d.status === f.status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, f.limit),
        countOpen: async () => values<Dispute>("disputes").filter((d) => d.status === "OPEN" || d.status === "IN_REVIEW").length,
        addNote: async (n) => {
          const id = values("disputeNotes").length + 1;
          put("disputeNotes", String(id), { ...n, id });
        },
        notes: async (disputeId) =>
          values<DisputeNote>("disputeNotes")
            .filter((n) => n.disputeId === disputeId)
            .sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
      },
      admin: {
        activeRole: async (userId) => {
          const r = values<RoleRecord>("adminRoles").find((r) => r.userId === userId && !r.revokedAt);
          return r && { userId: r.userId, role: r.role, grantedBy: r.grantedBy, grantedAt: r.grantedAt };
        },
        everHadRole: async (userId) => values<RoleRecord>("adminRoles").some((r) => r.userId === userId),
        listRoles: async () =>
          values<RoleRecord>("adminRoles")
            .filter((r) => !r.revokedAt)
            .sort((a, b) => a.grantedAt.localeCompare(b.grantedAt))
            .map((r) => ({ userId: r.userId, role: r.role, grantedBy: r.grantedBy, grantedAt: r.grantedAt })),
        grantRole: async (userId, role, by) => {
          const now = new Date().toISOString();
          for (const r of values<RoleRecord>("adminRoles").filter((r) => r.userId === userId && !r.revokedAt)) {
            put("adminRoles", r.id, { ...r, revokedAt: now, revokedBy: by ?? undefined });
          }
          const id = `r${values("adminRoles").length + 1}`;
          put("adminRoles", id, { id, userId, role, grantedBy: by ?? undefined, grantedAt: now });
        },
        revokeRole: async (userId, by) => {
          const now = new Date().toISOString();
          for (const r of values<RoleRecord>("adminRoles").filter((r) => r.userId === userId && !r.revokedAt)) {
            put("adminRoles", r.id, { ...r, revokedAt: now, revokedBy: by });
          }
        },
        putSession: async (s) => put("adminSessions", s.token, s),
        getSession: async (token) => get("adminSessions", token),
        touchSession: async (token, at) => {
          const s = get<AdminSession>("adminSessions", token);
          if (s) put("adminSessions", token, { ...s, lastSeenAt: Math.max(s.lastSeenAt, at) });
        },
        deleteSession: async (token) => del("adminSessions", token),
        deleteSessionsForUser: async (userId) => {
          for (const s of values<AdminSession>("adminSessions").filter((s) => s.userId === userId)) del("adminSessions", s.token);
        },
        putChallenge: async (c) => put("adminChallenges", c.nonce, c),
        takeChallenge: async (nonce, userId, at) => {
          const c = get<AdminChallenge>("adminChallenges", nonce);
          if (!c || c.userId !== userId || c.usedAt || c.expiresAt < at) return undefined;
          put("adminChallenges", nonce, { ...c, usedAt: at });
          return c;
        },
        audit: async (e) => {
          const id = values("audit").length + 1;
          put("audit", String(id), { ...e, id });
        },
        listAudit: async (f) =>
          values<AuditEntry>("audit")
            .filter(
              (e) => (!f.actorId || e.actorId === f.actorId) && (!f.targetType || e.targetType === f.targetType) && (!f.targetId || e.targetId === f.targetId),
            )
            .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
            .slice(0, f.limit),
        getSetting: async <T>(key: string) => get<T>("settings", key),
        allSettings: async () =>
          Object.fromEntries(Object.keys({ ...base.settings, ...Object.fromEntries(pending.settings ?? []) }).map((k) => [k, get("settings", k)])),
        putSetting: async (key, value) => put("settings", key, value),
        listAnnouncements: async () => values<Announcement>("announcements").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        putAnnouncement: async (a) => put("announcements", a.id, a),
        putAdjustment: async (a) => put("adjustments", a.id, a),
        getAdjustment: async (id) => get("adjustments", id),
        listAdjustments: async (status) =>
          values<Adjustment>("adjustments")
            .filter((a) => !status || a.status === status)
            .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      },
    };

    const result = await fn(t);
    // Commit.
    for (const [c, m] of Object.entries(pending) as [Coll, Map<string, unknown>][]) {
      const target = base[c] as Record<string, unknown>;
      for (const [id, v] of m) {
        if (v === DELETED) delete target[id];
        else target[id] = v;
      }
    }
    base.ledger.transactions.push(...pendingTxns);
    Object.assign(base.ledger.balances, pendingBalances);
    save(base);
    for (const f of committed) f();
    return result;
  }

  return {
    kind: "memory",
    tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
      const next = chain.then(() => run(fn));
      chain = next.catch(() => {});
      return next;
    },
    async reset() {
      g.__bgMem![cacheKey] = empty();
    },
  };
}
