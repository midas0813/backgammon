import fs from "node:fs";
import path from "node:path";
import type { Avatar, DepositIntent, MatchRecord, Session, Store, Tx, Txn, User, Withdrawal } from "./types";

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
      return [...ids].map((id) => getRaw<V>(c, id)).filter((v): v is V => v !== undefined).map(clone);
    };
    const allTxns = () => [...base.ledger.transactions, ...pendingTxns];
    const balance = (a: string) => pendingBalances[a] ?? base.ledger.balances[a] ?? 0;

    const t: Tx = {
      lock: async () => {},
      users: {
        get: async (id) => get("users", id),
        getMany: async (ids) => Object.fromEntries(ids.map((id) => [id, get<User>("users", id)]).filter(([, u]) => u)),
        byWallet: async (address) => values<User>("users").find((u) => u.walletAddress?.toLowerCase() === address.toLowerCase()),
        put: async (u) => put("users", u.id, u),
        count: async () => values("users").length,
      },
      sessions: {
        get: async (token) => get("sessions", token),
        put: async (token, s) => put("sessions", token, s),
        delete: async (token) => del("sessions", token),
      },
      matches: {
        get: async (id) => get("matches", id),
        put: async (rec) => put("matches", rec.id, rec),
        nextWaitingQuick: async (points, exclude) =>
          values<MatchRecord>("matches")
            .filter((m) => m.mode === "quick" && m.state.status === "WAITING" && m.state.targetPoints === points && m.seats[0] !== exclude)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0],
        listForUser: async (userId) => values<MatchRecord>("matches").filter((m) => m.seats.includes(userId)),
        listOpenQuick: async (exclude) =>
          values<MatchRecord>("matches")
            .filter((m) => m.mode === "quick" && m.state.status === "WAITING" && m.seats[0] !== exclude)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        stats: async () => {
          const all = values<MatchRecord>("matches");
          return {
            live: all.filter((m) => m.state.status === "ACTIVE").length,
            waiting: all.filter((m) => m.mode === "quick" && m.state.status === "WAITING").length,
            games: all.reduce((n, m) => n + m.state.results.length, 0),
          };
        },
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
      },
      withdrawals: {
        get: async (id) => get("withdrawals", id),
        byRef: async (ref) => values<Withdrawal>("withdrawals").find((w) => w.externalRef === ref),
        put: async (w) => put("withdrawals", w.id, w),
        listByUser: async (userId) =>
          values<Withdrawal>("withdrawals")
            .filter((w) => w.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
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

export type { Avatar };
