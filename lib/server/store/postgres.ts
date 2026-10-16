import { summarize } from "./summary";
import {
  SPECTATOR_WINDOW_MS,
  type Adjustment,
  type AdminRole,
  type Announcement,
  type AppError,
  type AuditEntry,
  type Avatar,
  type ChatMessage,
  type DepositIntent,
  type Dispute,
  type LobbyRow,
  type MatchRecord,
  type Session,
  type Store,
  type Tx,
  type Txn,
  type User,
  type UserRow,
  type Withdrawal,
} from "./types";

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
    status: r.status === "suspended" ? "suspended" : "active",
    suspendedUntil: r.suspended_until ? iso(r.suspended_until) : undefined,
    suspendedReason: (r.suspended_reason as string) ?? undefined,
  };
}

function toDispute(r: Row): Dispute {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    matchId: (r.match_id as string) ?? undefined,
    transactionId: (r.transaction_id as string) ?? undefined,
    category: r.category as Dispute["category"],
    reason: String(r.reason),
    status: String(r.status),
    createdAt: iso(r.created_at),
    assignedTo: (r.assigned_to as string) ?? undefined,
    resolution: (r.resolution as string) ?? undefined,
    updatedAt: r.updated_at ? iso(r.updated_at) : undefined,
  };
}

function toAdjustment(r: Row): Adjustment {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountKind: r.account_kind as Adjustment["accountKind"],
    amount: num(r.amount),
    reason: String(r.reason),
    status: r.status as Adjustment["status"],
    requestedBy: String(r.requested_by),
    requestedAt: iso(r.requested_at),
    decidedBy: (r.decided_by as string) ?? undefined,
    decidedAt: r.decided_at ? iso(r.decided_at) : undefined,
    txnKey: (r.txn_key as string) ?? undefined,
  };
}

function toChat(r: Row): ChatMessage {
  return {
    id: num(r.id),
    matchId: String(r.match_id),
    userId: String(r.user_id),
    name: String(r.name),
    role: r.role as ChatMessage["role"],
    kind: r.kind as ChatMessage["kind"],
    body: String(r.body),
    createdAt: iso(r.created_at),
    removedAt: r.removed_at ? iso(r.removed_at) : undefined,
    removedBy: (r.removed_by as string) ?? undefined,
  };
}

function toLobbyRow(r: Row): LobbyRow {
  const s = parse<{
    names: [string, string];
    score: [number, number];
    cube: number;
    gameNumber: number;
    hostId: string;
    seats?: [string | null, string | null];
    seatToAct?: number | null;
  }>(r.summary);
  return {
    id: String(r.id),
    mode: r.mode as LobbyRow["mode"],
    status: String(r.status),
    targetPoints: num(r.target_points),
    createdAt: iso(r.created_at),
    updatedAt: num(r.updated_ms),
    hostId: s.hostId,
    seats: s.seats ?? [s.hostId, null],
    names: s.names,
    score: s.score,
    cube: num(s.cube),
    gameNumber: num(s.gameNumber),
    seatToAct: s.seatToAct ?? null,
    allowSpectators: Boolean(r.allow_spectators),
    entryFee: num(r.entry_fee),
    hostSeenAt: num(r.host_seen_ms),
    spectators: num(r.spectators),
  };
}

const LOBBY_SELECT = `
  select m.id, m.mode, m.status, m.target_points, m.created_at, m.allow_spectators, m.summary, m.entry_fee,
         (extract(epoch from m.updated_at) * 1000)::float8 as updated_ms,
         coalesce((select (extract(epoch from p.seen_at) * 1000)::float8 from match_presence p
                   where p.match_id = m.id and p.seat = 0), 0) as host_seen_ms,
         (select count(*) from match_spectators s
            where s.match_id = m.id and s.seen_at >= now() - make_interval(secs => ${SPECTATOR_WINDOW_MS / 1000})) as spectators
  from matches m`;

const DAILY = (table: string, column: string) => `
  select to_char(d.day, 'YYYY-MM-DD') as day, count(t.${column}) as n
  from generate_series(date_trunc('day', now() at time zone 'utc') - make_interval(days => $1::int - 1),
                       date_trunc('day', now() at time zone 'utc'), interval '1 day') as d(day)
  left join ${table} t on (t.${column} at time zone 'utc') >= d.day and (t.${column} at time zone 'utc') < d.day + interval '1 day'
  group by d.day order by d.day`;

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

function makeTx(q: Query, committed: (() => void)[]): Tx {
  return {
    async lock(key) {
      await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
    },
    afterCommit(fn) {
      committed.push(fn);
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
             sound, high_contrast, board_orientation, status, suspended_until, suspended_reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           on conflict (id) do update set wallet_address = excluded.wallet_address, chain_id = excluded.chain_id,
             name = excluded.name, theme_id = excluded.theme_id, reduced_motion = excluded.reduced_motion, bio = excluded.bio,
             country = excluded.country, avatar = excluded.avatar, registered_at = excluded.registered_at,
             sound = excluded.sound, high_contrast = excluded.high_contrast, board_orientation = excluded.board_orientation,
             status = excluded.status, suspended_until = excluded.suspended_until, suspended_reason = excluded.suspended_reason`,
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
            u.status ?? "active",
            u.suspendedUntil ?? null,
            u.suspendedReason ?? null,
          ],
        );
      },
      async count() {
        const [r] = await q(`select count(*) as n from app_users`);
        return num(r.n);
      },
      async touchSeen(id, at) {
        await q(`update app_users set last_seen_at = greatest(coalesce(last_seen_at, '-infinity'), to_timestamp($2::float8 / 1000)) where id = $1`, [id, at]);
      },
      async countSeenSince(at) {
        const [r] = await q(`select count(*) as n from app_users where last_seen_at >= to_timestamp($1::float8 / 1000)`, [at]);
        return num(r.n);
      },
      async deleteInactiveGuests(before, limit) {
        const [r] = await q(
          `with g as (
             select u.id from app_users u
             where u.wallet_address is null and coalesce(u.last_seen_at, u.created_at) < to_timestamp($1::float8 / 1000)
               and not exists (select 1 from matches m where m.status in ('WAITING', 'ACTIVE') and m.mode in ('quick', 'private')
                                 and (m.seat0 = u.id::text or m.seat1 = u.id::text))
             order by coalesce(u.last_seen_at, u.created_at) limit $2),
           own as (
             select m.id from matches m where m.seat0 in (select id::text from g) and (m.mode in ('local', 'bot') or m.seat1 is null)),
           d1 as (delete from match_events where match_id in (select id from own)),
           d2 as (delete from match_actions where match_id in (select id from own)),
           d3 as (delete from match_presence where match_id in (select id from own)),
           d4 as (delete from match_spectators where match_id in (select id from own) or user_id in (select id from g)),
           d5 as (delete from matches where id in (select id from own)),
           d6 as (delete from match_results where user_id in (select id from g)),
           d7 as (delete from dispute_notes where dispute_id in (select id from disputes where user_id in (select id from g))),
           d8 as (delete from disputes where user_id in (select id from g)),
           gone as (delete from app_users where id in (select id from g) returning id)
           select count(*) as n from gone`,
          [before, limit],
        );
        return num(r.n);
      },
      async search(query, limit) {
        const q2 = query.trim();
        const rows = await q(
          `select * from app_users
           where $1 = '' or id::text = $1 or lower(name) like '%' || lower($1) || '%' or lower(coalesce(wallet_address, '')) like '%' || lower($1) || '%'
           order by created_at desc limit $2`,
          [q2, limit],
        );
        return rows.map((r): UserRow => ({ ...toUser(r), lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : undefined }));
      },
      async countCreatedSince(at) {
        const [r] = await q(`select count(*) as n from app_users where created_at >= to_timestamp($1::float8 / 1000)`, [at]);
        return num(r.n);
      },
      async countRegistered() {
        const [r] = await q(`select count(*) as n from app_users where wallet_address is not null`);
        return num(r.n);
      },
      async dailyNew(days) {
        const rows = await q(DAILY("app_users", "created_at"), [days]);
        return rows.map((r) => ({ day: String(r.day), n: num(r.n) }));
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
      async deleteForUser(userId) {
        const rows = await q(`delete from app_sessions where user_id = $1 returning token`, [userId]);
        return rows.length;
      },
    },
    matches: {
      async get(id, opts) {
        const [r] = await q(`select data from matches where id = $1 ${opts?.lock ? "for update" : ""}`, [id]);
        if (!r) return undefined;
        // Logs live in match_events / match_actions; the document carries only what this unit adds.
        return { ...parse<MatchRecord>(r.data), events: [], actions: {} };
      },
      async put(m) {
        const doc = { ...m, events: [], actions: {} };
        await q(
          `insert into matches (id, mode, status, target_points, created_by, seat0, seat1, version, created_at, updated_at, data,
             summary, allow_spectators, completed_at, entry_fee)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10::jsonb, $11::jsonb, $12, $13, $14)
           on conflict (id) do update set status = excluded.status, seat0 = excluded.seat0, seat1 = excluded.seat1,
             version = excluded.version, updated_at = now(), data = excluded.data, summary = excluded.summary,
             allow_spectators = excluded.allow_spectators, completed_at = excluded.completed_at, entry_fee = excluded.entry_fee`,
          [
            m.id,
            m.mode,
            m.state.status,
            m.state.targetPoints,
            m.createdBy,
            m.seats[0],
            m.seats[1],
            m.version,
            m.createdAt,
            JSON.stringify(doc),
            JSON.stringify(summarize(m)),
            m.allowSpectators !== false,
            m.completedAt ?? null,
            m.entryFee ?? 0,
          ],
        );
        if (m.events.length) {
          await q(
            `insert into match_events (match_id, seq, type, state_version, server_time, payload)
             select $1, x.seq, x.type, x.v, x.t, x.p
             from unnest($2::int[], $3::text[], $4::int[], $5::timestamptz[], $6::jsonb[]) as x(seq, type, v, t, p)
             on conflict do nothing`,
            [
              m.id,
              m.events.map((e) => e.seq),
              m.events.map((e) => e.type),
              m.events.map((e) => e.stateVersion),
              m.events.map((e) => e.serverTime),
              m.events.map((e) => JSON.stringify(e.payload)),
            ],
          );
        }
        const actions = Object.entries(m.actions);
        if (actions.length) {
          await q(
            `insert into match_actions (match_id, action_id, fingerprint, response)
             select $1, x.a, x.f, x.r from unnest($2::text[], $3::text[], $4::jsonb[]) as x(a, f, r)
             on conflict do nothing`,
            [m.id, actions.map(([id]) => id), actions.map(([, a]) => a.fingerprint), actions.map(([, a]) => JSON.stringify(a.response))],
          );
        }
      },
      async events(id, f) {
        const rows =
          f.last !== undefined
            ? (
                await q(
                  `select seq, type, state_version, server_time, payload from match_events where match_id = $1 and seq > $2
                   order by seq desc limit $3`,
                  [id, f.after ?? 0, f.last],
                )
              ).reverse()
            : await q(`select seq, type, state_version, server_time, payload from match_events where match_id = $1 and seq > $2 order by seq`, [
                id,
                f.after ?? 0,
              ]);
        return rows.map((r) => ({
          seq: num(r.seq),
          type: String(r.type),
          stateVersion: num(r.state_version),
          serverTime: iso(r.server_time),
          payload: parse<Record<string, unknown>>(r.payload),
        }));
      },
      async action(id, actionId) {
        const [r] = await q(`select fingerprint, response from match_actions where match_id = $1 and action_id = $2`, [id, actionId]);
        return r ? { fingerprint: String(r.fingerprint), response: parse(r.response) } : undefined;
      },
      async listOpen(userId, limit) {
        const rows = await q(
          `${LOBBY_SELECT} where (m.seat0 = $1 or m.seat1 = $1) and m.status in ('WAITING', 'ACTIVE')
           order by m.updated_at desc limit $2`,
          [userId, limit],
        );
        return rows.filter((r) => r.summary).map(toLobbyRow);
      },
      async staleTables(f) {
        const rows = await q(
          `select m.id from matches m
           left join match_presence p on p.match_id = m.id and p.seat = 0
           where m.status = 'WAITING' and (
             (m.mode = 'private' and m.created_at < to_timestamp($1::float8 / 1000)) or
             (m.mode = 'quick' and (coalesce(p.seen_at, m.created_at) < to_timestamp($2::float8 / 1000)
                                    or m.created_at < to_timestamp($3::float8 / 1000))))
           order by m.created_at limit $4`,
          [f.privateBefore, f.hostSeenBefore, f.publicBefore, f.limit],
        );
        return rows.map((r) => String(r.id));
      },
      async idleActive(f) {
        const rows = await q(
          `select m.id from matches m
           where m.status = 'ACTIVE' and (
             (m.mode in ('quick', 'private') and m.updated_at < to_timestamp($1::float8 / 1000)
               and (select count(*) from match_presence p where p.match_id = m.id and p.seen_at >= to_timestamp($2::float8 / 1000)) < 2) or
             (m.mode in ('bot', 'local') and m.updated_at < to_timestamp($3::float8 / 1000)))
           order by m.updated_at limit $4`,
          [f.onlineBefore, f.awayBefore, f.offlineBefore, f.limit],
        );
        return rows.map((r) => String(r.id));
      },
      async countActiveSince(since) {
        const [r] = await q(`select count(*) as n from matches where status = 'ACTIVE' and updated_at >= to_timestamp($1::float8 / 1000)`, [since]);
        return num(r.n);
      },
      async listPublic(f) {
        // Shared filter for the count and the page, so "N tables" always matches what can be paged.
        const where = `m.mode = 'quick' and m.status = $1
           and ($2::int is null or m.target_points = $2)
           and ($3::bigint is null or m.entry_fee >= $3)
           and ($4::bigint is null or m.entry_fee <= $4)
           and (case when $1 = 'WAITING'
                  then exists (select 1 from match_presence p where p.match_id = m.id and p.seat = 0
                               and p.seen_at >= to_timestamp($5::float8 / 1000))
                  else m.allow_spectators and m.updated_at >= to_timestamp($6::float8 / 1000) end)`;
        const params = [f.status, f.points ?? null, f.feeMin ?? null, f.feeMax ?? null, f.hostSeenSince, f.activeSince];
        const [c] = await q(`select count(*) as n from matches m where ${where}`, params);
        if (f.limit === 0) return { rows: [], total: num(c.n) };
        const rows = await q(`${LOBBY_SELECT} where ${where} order by m.created_at ${f.sort === "oldest" ? "asc" : "desc"} limit $7 offset $8`, [
          ...params,
          f.limit,
          f.offset,
        ]);
        return { rows: rows.filter((r) => r.summary).map(toLobbyRow), total: num(c.n) };
      },
      async listAdmin(f) {
        const rows = await q(
          `${LOBBY_SELECT} where ($1::text is null or m.status = $1) and ($2::text is null or m.seat0 = $2 or m.seat1 = $2)
           order by m.updated_at desc limit $3`,
          [f.status ?? null, f.userId ?? null, f.limit],
        );
        return rows.filter((r) => r.summary).map(toLobbyRow);
      },
      async countCompletedSince(at) {
        const [r] = await q(`select count(*) as n from matches where completed_at >= to_timestamp($1::float8 / 1000)`, [at]);
        return num(r.n);
      },
      async dailyCompleted(days) {
        const rows = await q(DAILY("matches", "completed_at"), [days]);
        return rows.map((r) => ({ day: String(r.day), n: num(r.n) }));
      },
    },
    results: {
      async put(rows) {
        if (rows.length === 0) return;
        await q(
          `insert into match_results (match_id, user_id, mode, won, points, games, gammons, opponent, score_for, score_against,
             target_points, end_reason, completed_at)
           select * from unnest($1::text[], $2::uuid[], $3::text[], $4::boolean[], $5::int[], $6::int[], $7::int[], $8::text[],
             $9::int[], $10::int[], $11::int[], $12::text[], $13::timestamptz[])
           on conflict do nothing`,
          [
            rows.map((r) => r.matchId),
            rows.map((r) => r.userId),
            rows.map((r) => r.mode),
            rows.map((r) => r.won),
            rows.map((r) => r.points),
            rows.map((r) => r.games),
            rows.map((r) => r.gammons),
            rows.map((r) => r.opponent),
            rows.map((r) => r.score[0]),
            rows.map((r) => r.score[1]),
            rows.map((r) => r.targetPoints),
            rows.map((r) => r.endReason),
            rows.map((r) => r.completedAt),
          ],
        );
      },
      async deleteForMatch(matchId) {
        const rows = await q(`delete from match_results where match_id = $1 returning user_id`, [matchId]);
        return rows.map((r) => String(r.user_id));
      },
      async stats(userId, since) {
        const [r] = await q(
          `with mine as (
             select won, points, games, gammons, completed_at from match_results
             where user_id = $1 and ($2::float8 is null or completed_at >= to_timestamp($2::float8 / 1000))),
           runs as (
             select won, count(*) filter (where not won) over (order by completed_at rows unbounded preceding) as grp from mine)
           select count(*) as played, count(*) filter (where won) as wins, coalesce(sum(points), 0) as points,
                  coalesce(sum(games), 0) as games, coalesce(sum(gammons), 0) as gammons,
                  (select count(*) from mine where won and completed_at > coalesce((select max(completed_at) from mine where not won), '-infinity')) as current_streak,
                  (select coalesce(max(n), 0) from (select count(*) as n from runs where won group by grp) s) as best_streak
           from mine`,
          [userId, since ?? null],
        );
        return {
          played: num(r.played),
          wins: num(r.wins),
          points: num(r.points),
          games: num(r.games),
          gammons: num(r.gammons),
          currentStreak: num(r.current_streak),
          bestStreak: num(r.best_streak),
        };
      },
      async history(userId, offset, limit) {
        const rows = await q(`select * from match_results where user_id = $1 order by completed_at desc limit $2 offset $3`, [userId, limit, offset]);
        return rows.map((r) => ({
          matchId: String(r.match_id),
          userId: String(r.user_id),
          mode: r.mode as LobbyRow["mode"],
          won: Boolean(r.won),
          points: num(r.points),
          games: num(r.games),
          gammons: num(r.gammons),
          opponent: String(r.opponent),
          score: [num(r.score_for), num(r.score_against)] as [number, number],
          targetPoints: num(r.target_points),
          endReason: String(r.end_reason),
          completedAt: iso(r.completed_at),
        }));
      },
    },
    chat: {
      async add(m) {
        const [r] = await q(`insert into match_chat (match_id, user_id, name, role, kind, body) values ($1, $2, $3, $4, $5, $6) returning *`, [
          m.matchId,
          m.userId,
          m.name,
          m.role,
          m.kind,
          m.body,
        ]);
        return toChat(r);
      },
      async list(matchId, after, limit) {
        const rows = await q(`select * from match_chat where match_id = $1 and id > $2 order by id desc limit $3`, [matchId, after, limit]);
        return rows.reverse().map(toChat);
      },
      async get(id) {
        const [r] = await q(`select * from match_chat where id = $1`, [id]);
        return r ? toChat(r) : undefined;
      },
      async remove(id, by) {
        await q(`update match_chat set removed_at = now(), removed_by = $2 where id = $1 and removed_at is null`, [id, by]);
      },
    },
    errors: {
      async add(e) {
        await q(`insert into app_errors (ref, source, message, detail, path, user_id) values ($1, $2, $3, $4, $5, $6)`, [
          e.ref,
          e.source,
          e.message,
          e.detail ?? null,
          e.path ?? null,
          e.userId ?? null,
        ]);
      },
      async recent(limit) {
        const rows = await q(`select * from app_errors order by id desc limit $1`, [limit]);
        return rows.map((r): AppError => ({
          id: num(r.id),
          ref: String(r.ref),
          source: r.source as AppError["source"],
          message: String(r.message),
          detail: (r.detail as string) ?? undefined,
          path: (r.path as string) ?? undefined,
          userId: (r.user_id as string) ?? undefined,
          createdAt: iso(r.created_at),
        }));
      },
      async countSince(at) {
        const [r] = await q(`select count(*) as n from app_errors where created_at >= to_timestamp($1::float8 / 1000)`, [at]);
        return num(r.n);
      },
      async prune(before) {
        await q(`delete from app_errors where created_at < to_timestamp($1::float8 / 1000)`, [before]);
      },
    },
    rateLimits: {
      async hit(key, windowStart) {
        const [r] = await q(
          `insert into rate_limits (key, window_start, count) values ($1, to_timestamp($2::float8 / 1000), 1)
           on conflict (key) do update set
             count = case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end,
             window_start = excluded.window_start
           returning count`,
          [key, windowStart],
        );
        return num(r.count);
      },
      async prune(before) {
        await q(`delete from rate_limits where window_start < to_timestamp($1::float8 / 1000)`, [before]);
      },
    },
    counters: {
      async add(key, n) {
        await q(`insert into app_counters (key, value) values ($1, $2) on conflict (key) do update set value = app_counters.value + excluded.value`, [key, n]);
      },
      async get(keys) {
        const rows = await q(`select key, value from app_counters where key = any($1::text[])`, [keys]);
        const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
        for (const r of rows) out[String(r.key)] = num(r.value);
        return out;
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
      async listAll(f) {
        const rows = await q(`select data from deposit_intents where ($1::text is null or status = $1) order by created_at desc limit $2`, [
          f.status ?? null,
          f.limit,
        ]);
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
      async listAll(f) {
        const rows = await q(`select data from withdrawals where ($1::text is null or status = $1) order by created_at desc limit $2`, [
          f.status ?? null,
          f.limit,
        ]);
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
        const rows = await q(`select account, balance from ledger_accounts where account = any($1::text[]) order by account ${lock ? "for update" : ""}`, [
          sorted,
        ]);
        const out: Record<string, number> = Object.fromEntries(accounts.map((a) => [a, 0]));
        for (const r of rows) out[String(r.account)] = num(r.balance);
        return out;
      },
      async txnByKey(key) {
        const [r] = await q(`${TXN_SELECT} where t.key = $1 group by t.id`, [key]);
        return r ? toTxn(r) : undefined;
      },
      async insert(txn, next) {
        const [t] = await q(`insert into ledger_transactions (key, type, memo, created_at) values ($1, $2, $3, $4) returning id::text as id`, [
          txn.key,
          txn.type,
          txn.memo,
          txn.createdAt,
        ]);
        await q(
          `insert into ledger_entries (txn_id, account, amount)
           select $1::bigint, a, b from unnest($2::text[], $3::bigint[]) as x(a, b)`,
          [t.id, txn.entries.map((e) => e.account), txn.entries.map((e) => String(e.amount))],
        );
        const accounts = Object.keys(next);
        await q(`update ledger_accounts set balance = v.b from unnest($1::text[], $2::bigint[]) as v(a, b) where account = v.a`, [
          accounts,
          accounts.map((a) => String(next[a])),
        ]);
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
    spectators: {
      async touch(matchId, userId, at) {
        await q(
          `insert into match_spectators (match_id, user_id, seen_at) values ($1, $2, to_timestamp($3::float8 / 1000))
           on conflict (match_id, user_id) do update set seen_at = greatest(match_spectators.seen_at, excluded.seen_at)`,
          [matchId, userId, at],
        );
      },
      async count(matchId, since) {
        const [r] = await q(`select count(*) as n from match_spectators where match_id = $1 and seen_at >= to_timestamp($2::float8 / 1000)`, [matchId, since]);
        return num(r.n);
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
        return rows.map(toDispute);
      },
      async get(id) {
        const [r] = await q(`select * from disputes where id = $1`, [id]);
        return r ? toDispute(r) : undefined;
      },
      async update(d) {
        await q(`update disputes set status = $2, assigned_to = $3, resolution = $4, updated_at = now() where id = $1`, [
          d.id,
          d.status,
          d.assignedTo ?? null,
          d.resolution ?? null,
        ]);
      },
      async listAll(f) {
        const rows = await q(`select * from disputes where ($1::text is null or status = $1) order by created_at desc limit $2`, [f.status ?? null, f.limit]);
        return rows.map(toDispute);
      },
      async countOpen() {
        const [r] = await q(`select count(*) as n from disputes where status in ('OPEN', 'IN_REVIEW')`);
        return num(r.n);
      },
      async addNote(n) {
        await q(`insert into dispute_notes (dispute_id, author_id, note, created_at) values ($1, $2, $3, $4)`, [n.disputeId, n.authorId, n.note, n.createdAt]);
      },
      async notes(disputeId) {
        const rows = await q(`select * from dispute_notes where dispute_id = $1 order by id`, [disputeId]);
        return rows.map((r) => ({
          id: num(r.id),
          disputeId: String(r.dispute_id),
          authorId: String(r.author_id),
          note: String(r.note),
          createdAt: iso(r.created_at),
        }));
      },
    },
    admin: {
      async activeRole(userId) {
        const [r] = await q(`select * from admin_roles where user_id = $1 and revoked_at is null`, [userId]);
        return r
          ? { userId: String(r.user_id), role: r.role as AdminRole, grantedBy: (r.granted_by as string) ?? undefined, grantedAt: iso(r.granted_at) }
          : undefined;
      },
      async everHadRole(userId) {
        const [r] = await q(`select 1 from admin_roles where user_id = $1 limit 1`, [userId]);
        return !!r;
      },
      async listRoles() {
        const rows = await q(`select * from admin_roles where revoked_at is null order by granted_at`);
        return rows.map((r) => ({
          userId: String(r.user_id),
          role: r.role as AdminRole,
          grantedBy: (r.granted_by as string) ?? undefined,
          grantedAt: iso(r.granted_at),
        }));
      },
      async grantRole(userId, role, by) {
        await q(`update admin_roles set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null`, [userId, by]);
        await q(`insert into admin_roles (user_id, role, granted_by) values ($1, $2, $3)`, [userId, role, by]);
      },
      async revokeRole(userId, by) {
        await q(`update admin_roles set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null`, [userId, by]);
      },
      async putSession(s) {
        await q(
          `insert into admin_sessions (token, user_id, created_at, last_seen_at, ip, user_agent)
           values ($1, $2, to_timestamp($3::float8 / 1000), to_timestamp($4::float8 / 1000), $5, $6)`,
          [s.token, s.userId, s.createdAt, s.lastSeenAt, s.ip ?? null, s.userAgent ?? null],
        );
      },
      async getSession(token) {
        const [r] = await q(
          `select token, user_id, (extract(epoch from created_at) * 1000)::float8 as c, (extract(epoch from last_seen_at) * 1000)::float8 as l, ip, user_agent
           from admin_sessions where token = $1`,
          [token],
        );
        return r
          ? {
              token: String(r.token),
              userId: String(r.user_id),
              createdAt: num(r.c),
              lastSeenAt: num(r.l),
              ip: (r.ip as string) ?? undefined,
              userAgent: (r.user_agent as string) ?? undefined,
            }
          : undefined;
      },
      async touchSession(token, at) {
        await q(`update admin_sessions set last_seen_at = greatest(last_seen_at, to_timestamp($2::float8 / 1000)) where token = $1`, [token, at]);
      },
      async deleteSession(token) {
        await q(`delete from admin_sessions where token = $1`, [token]);
      },
      async deleteSessionsForUser(userId) {
        await q(`delete from admin_sessions where user_id = $1`, [userId]);
      },
      async putChallenge(c) {
        await q(
          `insert into admin_challenges (nonce, user_id, purpose, message, details, expires_at) values ($1, $2, $3, $4, $5::jsonb, to_timestamp($6::float8 / 1000))`,
          [c.nonce, c.userId, c.purpose, c.message, JSON.stringify(c.details), c.expiresAt],
        );
      },
      async takeChallenge(nonce, userId, at) {
        const [r] = await q(
          `update admin_challenges set used_at = to_timestamp($3::float8 / 1000)
           where nonce = $1 and user_id = $2 and used_at is null and expires_at >= to_timestamp($3::float8 / 1000)
           returning nonce, user_id, purpose, message, details, (extract(epoch from expires_at) * 1000)::float8 as exp`,
          [nonce, userId, at],
        );
        return r
          ? {
              nonce: String(r.nonce),
              userId: String(r.user_id),
              purpose: String(r.purpose),
              message: String(r.message),
              details: parse(r.details),
              expiresAt: num(r.exp),
              usedAt: at,
            }
          : undefined;
      },
      async audit(e) {
        await q(
          `insert into admin_audit (at, actor_id, actor_role, action, target_type, target_id, reason, details, ip, user_agent, signature)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
          [
            e.at,
            e.actorId ?? null,
            e.actorRole ?? null,
            e.action,
            e.targetType ?? null,
            e.targetId ?? null,
            e.reason ?? null,
            JSON.stringify(e.details),
            e.ip ?? null,
            e.userAgent ?? null,
            e.signature ?? null,
          ],
        );
      },
      async listAudit(f) {
        const rows = await q(
          `select * from admin_audit where ($1::uuid is null or actor_id = $1) and ($2::text is null or target_type = $2) and ($3::text is null or target_id = $3)
           order by id desc limit $4`,
          [f.actorId ?? null, f.targetType ?? null, f.targetId ?? null, f.limit],
        );
        return rows.map((r): AuditEntry => ({
          id: num(r.id),
          at: iso(r.at),
          actorId: (r.actor_id as string) ?? undefined,
          actorRole: (r.actor_role as string) ?? undefined,
          action: String(r.action),
          targetType: (r.target_type as string) ?? undefined,
          targetId: (r.target_id as string) ?? undefined,
          reason: (r.reason as string) ?? undefined,
          details: parse(r.details),
          ip: (r.ip as string) ?? undefined,
          userAgent: (r.user_agent as string) ?? undefined,
          signature: (r.signature as string) ?? undefined,
        }));
      },
      async getSetting<T>(key: string) {
        const [r] = await q(`select value from app_settings where key = $1`, [key]);
        return r ? parse<T>(r.value) : undefined;
      },
      async allSettings() {
        const rows = await q(`select key, value from app_settings`);
        return Object.fromEntries(rows.map((r) => [String(r.key), parse(r.value)]));
      },
      async putSetting(key, value, by) {
        await q(
          `insert into app_settings (key, value, updated_by) values ($1, $2::jsonb, $3)
           on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), by],
        );
      },
      async listAnnouncements() {
        const rows = await q(`select * from announcements order by created_at desc limit 50`);
        return rows.map((r): Announcement => ({
          id: String(r.id),
          message: String(r.message),
          tone: r.tone as Announcement["tone"],
          active: Boolean(r.active),
          createdAt: iso(r.created_at),
          createdBy: (r.created_by as string) ?? undefined,
          expiresAt: r.expires_at ? iso(r.expires_at) : undefined,
        }));
      },
      async putAnnouncement(a) {
        await q(
          `insert into announcements (id, message, tone, active, created_at, created_by, expires_at) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (id) do update set message = excluded.message, tone = excluded.tone, active = excluded.active, expires_at = excluded.expires_at`,
          [a.id, a.message, a.tone, a.active, a.createdAt, a.createdBy ?? null, a.expiresAt ?? null],
        );
      },
      async putAdjustment(a) {
        await q(
          `insert into admin_adjustments (id, user_id, account_kind, amount, reason, status, requested_by, requested_at, decided_by, decided_at, txn_key)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at, txn_key = excluded.txn_key`,
          [
            a.id,
            a.userId,
            a.accountKind,
            String(a.amount),
            a.reason,
            a.status,
            a.requestedBy,
            a.requestedAt,
            a.decidedBy ?? null,
            a.decidedAt ?? null,
            a.txnKey ?? null,
          ],
        );
      },
      async getAdjustment(id, opts) {
        const [r] = await q(`select * from admin_adjustments where id = $1 ${opts?.lock ? "for update" : ""}`, [id]);
        return r ? toAdjustment(r) : undefined;
      },
      async listAdjustments(status) {
        const rows = await q(`select * from admin_adjustments where ($1::text is null or status = $1) order by requested_at desc limit 100`, [status ?? null]);
        return rows.map(toAdjustment);
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
      const committed: (() => void)[] = [];
      const result = await driver.begin((q) => fn(makeTx(q, committed)));
      for (const f of committed) f();
      return result;
    },
    reset: async () => {
      await ensure();
      await driver.reset?.();
    },
  };
}
