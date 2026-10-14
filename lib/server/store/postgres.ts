import type { Avatar, DepositIntent, Dispute, MatchRecord, Session, Store, Tx, Txn, User, Withdrawal } from "./types";

/** Minimal driver surface so the same SQL runs on Supabase (postgres.js) and in tests (PGlite). */
export type Query = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;
/** Run a multi-statement SQL script (no parameters). */
export type Exec = (sql: string) => Promise<void>;
export interface Driver {
  begin<T>(fn: (q: Query, exec: Exec) => Promise<T>): Promise<T>;
  reset?(): Promise<void>;
}

export interface Migration {
  name: string;
  sql: string;
}

/**
 * Apply pending migrations once, in name order, under a transaction-scoped advisory lock so parallel
 * cold starts cannot race. Applied names are recorded in app_schema_migrations. The SQL files are
 * idempotent, so a migration that the Supabase CLI/GitHub integration already ran is harmless.
 */
export async function runMigrations(driver: Driver, migrations: Migration[]): Promise<string[]> {
  return driver.begin(async (q, exec) => {
    await q(`select pg_advisory_xact_lock(7272741)`);
    await exec(`create table if not exists app_schema_migrations (name text primary key, applied_at timestamptz not null default now());
      alter table app_schema_migrations enable row level security;`);
    const done = new Set((await q<{ name: string }>(`select name from app_schema_migrations`)).map((r) => r.name));
    const applied: string[] = [];
    for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
      if (done.has(m.name)) continue;
      await exec(m.sql);
      await q(`insert into app_schema_migrations (name) values ($1)`, [m.name]);
      applied.push(m.name);
    }
    return applied;
  });
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toUser(r: Row): User {
  return {
    id: String(r.id),
    walletAddress: (r.wallet_address as string) ?? undefined,
    chainId: r.chain_id === null || r.chain_id === undefined ? undefined : Number(r.chain_id),
    name: String(r.name),
    themeId: String(r.theme_id),
    reducedMotion: Boolean(r.reduced_motion),
    bio: String(r.bio ?? ""),
    country: String(r.country ?? ""),
    avatar: (r.avatar as string) ?? undefined,
    sound: r.sound === undefined ? true : Boolean(r.sound),
    highContrast: Boolean(r.high_contrast),
    boardOrientation: r.board_orientation === "left" ? "left" : "right",
    createdAt: iso(r.created_at),
    registeredAt: r.registered_at ? iso(r.registered_at) : undefined,
  };
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

const TXN_SELECT = `
  select t.id::text as id, t.key, t.type, t.memo, t.created_at,
         coalesce(json_agg(json_build_object('account', e.account, 'amount', e.amount) order by e.id)
                  filter (where e.id is not null), '[]') as entries
  from ledger_transactions t left join ledger_entries e on e.txn_id = t.id`;

function toTxn(r: Row): Txn {
  return {
    id: `txn_${r.id}`,
    key: String(r.key),
    type: String(r.type),
    memo: String(r.memo ?? ""),
    createdAt: iso(r.created_at),
    entries: parse<{ account: string; amount: number | string }[]>(r.entries).map((e) => ({ account: e.account, amount: Number(e.amount) })),
  };
}

function makeTx(q: Query): Tx {
  return {
    async lock(key) {
      await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
    },
    users: {
      async get(id) {
        const [r] = await q(`select * from app_users where id = $1`, [id]);
        return r ? toUser(r) : undefined;
      },
      async getMany(ids) {
        if (ids.length === 0) return {};
        const rows = await q(`select * from app_users where id = any($1::uuid[])`, [ids]);
        return Object.fromEntries(rows.map((r) => [String(r.id), toUser(r)]));
      },
      async byWallet(address) {
        const [r] = await q(`select * from app_users where lower(wallet_address) = lower($1)`, [address]);
        return r ? toUser(r) : undefined;
      },
      async put(u) {
        await q(
          `insert into app_users (id, wallet_address, chain_id, name, theme_id, reduced_motion, bio, country, avatar, created_at, registered_at,
             sound, high_contrast, board_orientation)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           on conflict (id) do update set wallet_address = excluded.wallet_address, chain_id = excluded.chain_id,
             name = excluded.name, theme_id = excluded.theme_id, reduced_motion = excluded.reduced_motion, bio = excluded.bio,
             country = excluded.country, avatar = excluded.avatar, registered_at = excluded.registered_at,
             sound = excluded.sound, high_contrast = excluded.high_contrast, board_orientation = excluded.board_orientation`,
          [
            u.id,
            u.walletAddress ?? null,
            u.chainId ?? null,
            u.name,
            u.themeId,
            u.reducedMotion,
            u.bio ?? "",
            u.country ?? "",
            u.avatar ?? null,
            u.createdAt,
            u.registeredAt ?? null,
            u.sound ?? true,
            u.highContrast ?? false,
            u.boardOrientation ?? "right",
          ],
        );
      },
      async count() {
        const [r] = await q(`select count(*) as n from app_users`);
        return num(r.n);
      },
    },
    sessions: {
      async get(token) {
        const [r] = await q(
          `select user_id, created_at, siwe_nonce, (extract(epoch from siwe_nonce_expires_at) * 1000)::float8 as exp
           from app_sessions where token = $1`,
          [token],
        );
        if (!r) return undefined;
        const s: Session = { userId: String(r.user_id), createdAt: iso(r.created_at) };
        if (r.siwe_nonce) {
          s.siweNonce = String(r.siwe_nonce);
          s.siweNonceExpiresAt = num(r.exp);
        }
        return s;
      },
      async put(token, s) {
        await q(
          `insert into app_sessions (token, user_id, created_at, siwe_nonce, siwe_nonce_expires_at)
           values ($1, $2, $3, $4, case when $5::float8 is null then null else to_timestamp($5::float8 / 1000) end)
           on conflict (token) do update set user_id = excluded.user_id, siwe_nonce = excluded.siwe_nonce,
             siwe_nonce_expires_at = excluded.siwe_nonce_expires_at`,
          [token, s.userId, s.createdAt, s.siweNonce ?? null, s.siweNonceExpiresAt ?? null],
        );
      },
      async delete(token) {
        await q(`delete from app_sessions where token = $1`, [token]);
      },
    },
    matches: {
      async get(id, opts) {
        const [r] = await q(`select data from matches where id = $1 ${opts?.lock ? "for update" : ""}`, [id]);
        return r ? parse<MatchRecord>(r.data) : undefined;
      },
      async put(m) {
        await q(
          `insert into matches (id, mode, status, target_points, created_by, seat0, seat1, version, created_at, updated_at, data)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10::jsonb)
           on conflict (id) do update set status = excluded.status, seat0 = excluded.seat0, seat1 = excluded.seat1,
             version = excluded.version, updated_at = now(), data = excluded.data`,
          [m.id, m.mode, m.state.status, m.state.targetPoints, m.createdBy, m.seats[0], m.seats[1], m.version, m.createdAt, JSON.stringify(m)],
        );
      },
      async nextWaitingQuick(points, exclude) {
        const [r] = await q(
          `select data from matches where mode = 'quick' and status = 'WAITING' and target_points = $1 and seat0 <> $2
           order by created_at limit 1 for update skip locked`,
          [points, exclude],
        );
        return r ? parse<MatchRecord>(r.data) : undefined;
      },
      async listForUser(userId) {
        const rows = await q(`select data from matches where seat0 = $1 or seat1 = $1 order by created_at desc limit 200`, [userId]);
        return rows.map((r) => parse<MatchRecord>(r.data));
      },
      async listOpenQuick(exclude) {
        const rows = await q(
          `select data from matches where mode = 'quick' and status = 'WAITING' and seat0 <> $1 order by created_at limit 50`,
          [exclude],
        );
        return rows.map((r) => parse<MatchRecord>(r.data));
      },
      async stats() {
        const [r] = await q(
          `select count(*) filter (where status = 'ACTIVE') as live,
                  count(*) filter (where status = 'WAITING' and mode = 'quick') as waiting,
                  coalesce(sum(jsonb_array_length(data->'state'->'results')), 0) as games
           from matches`,
        );
        return { live: num(r.live), waiting: num(r.waiting), games: num(r.games) };
      },
    },
    idempotency: {
      async get(key) {
        const [r] = await q(`select fingerprint, response from idempotency_keys where key = $1`, [key]);
        return r ? { fingerprint: String(r.fingerprint), response: parse(r.response) } : undefined;
      },
      async put(key, v) {
        await q(`insert into idempotency_keys (key, fingerprint, response) values ($1, $2, $3::jsonb)`, [key, v.fingerprint, JSON.stringify(v.response)]);
      },
    },
    deposits: {
      async get(id) {
        const [r] = await q(`select data from deposit_intents where id = $1`, [id]);
        return r ? parse<DepositIntent>(r.data) : undefined;
      },
      async byRef(ref, opts) {
        const [r] = await q(`select data from deposit_intents where external_ref = $1 ${opts?.lock ? "for update" : ""}`, [ref]);
        return r ? parse<DepositIntent>(r.data) : undefined;
      },
      async put(d) {
        await q(
          `insert into deposit_intents (id, user_id, external_ref, status, created_at, data) values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (id) do update set status = excluded.status, data = excluded.data`,
          [d.id, d.userId, d.externalRef, d.status, d.createdAt, JSON.stringify(d)],
        );
      },
      async listByUser(userId) {
        const rows = await q(`select data from deposit_intents where user_id = $1 order by created_at desc limit 50`, [userId]);
        return rows.map((r) => parse<DepositIntent>(r.data));
      },
    },
    withdrawals: {
      async get(id, opts) {
        const [r] = await q(`select data from withdrawals where id = $1 ${opts?.lock ? "for update" : ""}`, [id]);
        return r ? parse<Withdrawal>(r.data) : undefined;
      },
      async byRef(ref, opts) {
        const [r] = await q(`select data from withdrawals where external_ref = $1 ${opts?.lock ? "for update" : ""}`, [ref]);
        return r ? parse<Withdrawal>(r.data) : undefined;
      },
      async put(w) {
        await q(
          `insert into withdrawals (id, user_id, external_ref, status, created_at, data) values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (id) do update set status = excluded.status, data = excluded.data`,
          [w.id, w.userId, w.externalRef, w.status, w.createdAt, JSON.stringify(w)],
        );
      },
      async listByUser(userId) {
        const rows = await q(`select data from withdrawals where user_id = $1 order by created_at desc limit 50`, [userId]);
        return rows.map((r) => parse<Withdrawal>(r.data));
      },
    },
    paymentEvents: {
      async get(id) {
        const [r] = await q(`select outcome from payment_events where event_id = $1`, [id]);
        return r ? { outcome: String(r.outcome) } : undefined;
      },
      async put(id, outcome) {
        await q(`insert into payment_events (event_id, outcome) values ($1, $2)`, [id, outcome]);
      },
    },
    ledger: {
      async balances(accounts, lock) {
        if (accounts.length === 0) return {};
        const sorted = [...accounts].sort(); // consistent lock order avoids deadlocks
        if (lock) {
          await q(`insert into ledger_accounts (account) select unnest($1::text[]) on conflict do nothing`, [sorted]);
        }
        const rows = await q(
          `select account, balance from ledger_accounts where account = any($1::text[]) order by account ${lock ? "for update" : ""}`,
          [sorted],
        );
        const out: Record<string, number> = Object.fromEntries(accounts.map((a) => [a, 0]));
        for (const r of rows) out[String(r.account)] = num(r.balance);
        return out;
      },
      async txnByKey(key) {
        const [r] = await q(`${TXN_SELECT} where t.key = $1 group by t.id`, [key]);
        return r ? toTxn(r) : undefined;
      },
      async insert(txn, next) {
        const [t] = await q(
          `insert into ledger_transactions (key, type, memo, created_at) values ($1, $2, $3, $4) returning id::text as id`,
          [txn.key, txn.type, txn.memo, txn.createdAt],
        );
        await q(
          `insert into ledger_entries (txn_id, account, amount)
           select $1::bigint, a, b from unnest($2::text[], $3::bigint[]) as x(a, b)`,
          [t.id, txn.entries.map((e) => e.account), txn.entries.map((e) => String(e.amount))],
        );
        const accounts = Object.keys(next);
        await q(
          `update ledger_accounts set balance = v.b from unnest($1::text[], $2::bigint[]) as v(a, b) where account = v.a`,
          [accounts, accounts.map((a) => String(next[a]))],
        );
        return { ...txn, id: `txn_${t.id}` };
      },
      async userTransactions(userId, limit) {
        const rows = await q(
          `${TXN_SELECT} where t.id in (select txn_id from ledger_entries where account like $1)
           group by t.id order by t.id desc limit $2`,
          [`user:${userId}:%`, limit],
        );
        return rows.map(toTxn);
      },
      async dump() {
        const txns = await q(`${TXN_SELECT} group by t.id order by t.id`);
        const bals = await q(`select account, balance from ledger_accounts`);
        return { transactions: txns.map(toTxn), balances: Object.fromEntries(bals.map((r) => [String(r.account), num(r.balance)])) };
      },
    },
    avatars: {
      async put(a: Avatar) {
        await q(
          `insert into app_avatars (file, user_id, content_type, bytes) values ($1, $2, $3, $4)
           on conflict (file) do update set bytes = excluded.bytes, content_type = excluded.content_type`,
          [a.file, a.userId, a.contentType, a.bytes],
        );
      },
      async get(file) {
        const [r] = await q(`select file, user_id, content_type, bytes from app_avatars where file = $1`, [file]);
        if (!r) return undefined;
        return { file: String(r.file), userId: String(r.user_id), contentType: String(r.content_type), bytes: new Uint8Array(r.bytes as ArrayBuffer) };
      },
      async delete(file) {
        await q(`delete from app_avatars where file = $1`, [file]);
      },
    },
    presence: {
      async touch(matchId, seat, at) {
        await q(
          `insert into match_presence (match_id, seat, seen_at) values ($1, $2, to_timestamp($3::float8 / 1000))
           on conflict (match_id, seat) do update set seen_at = greatest(match_presence.seen_at, excluded.seen_at)`,
          [matchId, seat, at],
        );
      },
      async get(matchId) {
        const rows = await q(`select seat, (extract(epoch from seen_at) * 1000)::float8 as ms from match_presence where match_id = $1`, [matchId]);
        const out: [number, number] = [0, 0];
        for (const r of rows) out[Number(r.seat)] = num(r.ms);
        return out;
      },
    },
    disputes: {
      async put(d: Dispute) {
        await q(
          `insert into disputes (id, user_id, match_id, transaction_id, category, reason, status, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [d.id, d.userId, d.matchId ?? null, d.transactionId ?? null, d.category, d.reason, d.status, d.createdAt],
        );
      },
      async listByUser(userId) {
        const rows = await q(`select * from disputes where user_id = $1 order by created_at desc limit 20`, [userId]);
        return rows.map((r) => ({
          id: String(r.id),
          userId: String(r.user_id),
          matchId: (r.match_id as string) ?? undefined,
          transactionId: (r.transaction_id as string) ?? undefined,
          category: r.category as Dispute["category"],
          reason: String(r.reason),
          status: String(r.status),
          createdAt: iso(r.created_at),
        }));
      },
    },
  };
}

export function createPostgresStore(driver: Driver, migrations: Migration[] = []): Store {
  // Apply the schema once per process before the first unit of work; retry on the next call if it fails.
  let ready: Promise<unknown> | null = null;
  const ensure = () => {
    ready ??= runMigrations(driver, migrations).catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  };
  return {
    kind: "postgres",
    tx: async (fn) => {
      await ensure();
      return driver.begin((q) => fn(makeTx(q)));
    },
    reset: async () => {
      await ensure();
      await driver.reset?.();
    },
  };
}
