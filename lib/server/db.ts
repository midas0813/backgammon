import fs from "node:fs";
import path from "node:path";
import type { MatchState } from "../engine/match";
import { emptyLedger, type LedgerState } from "./ledger";
import type { DepositMethod, DepositStatus, WithdrawalStatus } from "./payments/adapter";

/**
 * MVP persistence: a single JSON document, mutated only inside `transact`, which works on a copy and
 * commits all-or-nothing, then writes atomically (tmp file + rename). Node runs each transaction
 * synchronously, so transactions are serialised — equivalent to a per-match lock for one process.
 *
 * Production replacement: a transactional database (e.g. Postgres) with the same entity boundaries,
 * unique constraints on action IDs / settlement keys / payment event IDs, and an outbox table.
 */

export interface User {
  id: string;
  name: string;
  themeId: string;
  reducedMotion: boolean;
  createdAt: string;
}

export interface StoredEvent {
  seq: number;
  type: string;
  stateVersion: number;
  serverTime: string;
  payload: Record<string, unknown>;
}

export type MatchMode = "quick" | "private" | "local" | "bot";

export interface MatchRecord {
  id: string;
  mode: MatchMode;
  createdAt: string;
  createdBy: string;
  seats: [string | null, string | null];
  names: [string, string];
  lastSeen: [number, number];
  version: number;
  /** ms timestamp of the last committed state change (paces the computer opponent). */
  updatedAt?: number;
  state: MatchState;
  events: StoredEvent[];
  eventSeq: number;
  /** actionId → original response, for idempotent retries. */
  actions: Record<string, { fingerprint: string; response: unknown }>;
}

export interface DepositIntent {
  id: string;
  userId: string;
  method: DepositMethod;
  asset?: string;
  network?: string;
  tokenUnits: number;
  usdCents: number;
  feeCents: number;
  rate: string;
  status: DepositStatus;
  externalRef: string;
  instructions: string;
  expiresAt: string;
  createdAt: string;
  history: { status: string; at: string; eventId?: string; note?: string }[];
}

export interface Withdrawal {
  id: string;
  userId: string;
  amountUnits: number;
  destination: string;
  status: WithdrawalStatus;
  externalRef: string;
  createdAt: string;
  history: { status: string; at: string; eventId?: string; note?: string }[];
}

export interface Db {
  users: Record<string, User>;
  matches: Record<string, MatchRecord>;
  ledger: LedgerState;
  deposits: Record<string, DepositIntent>;
  withdrawals: Record<string, Withdrawal>;
  paymentEvents: Record<string, { processedAt: string; outcome: string }>;
  idempotency: Record<string, { fingerprint: string; response: unknown }>;
}

const emptyDb = (): Db => ({
  users: {},
  matches: {},
  ledger: emptyLedger(),
  deposits: {},
  withdrawals: {},
  paymentEvents: {},
  idempotency: {},
});

const DB_FILE = process.env.BG_DB_FILE ?? path.join(process.cwd(), ".data", "db.json");
const IN_MEMORY = DB_FILE === ":memory:";

const g = globalThis as unknown as { __bgDb?: Db };

function load(): Db {
  if (g.__bgDb) return g.__bgDb;
  let db = emptyDb();
  if (!IN_MEMORY && fs.existsSync(/*turbopackIgnore: true*/ DB_FILE)) {
    db = { ...db, ...(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ DB_FILE, "utf8")) as Db) };
  }
  g.__bgDb = db;
  return db;
}

function save(db: Db) {
  if (IN_MEMORY) return;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/** Read-only access. Do not mutate the returned object. */
export function read<T>(fn: (db: Db) => T): T {
  return fn(load());
}

/** Run `fn` against a copy; commit and persist only if it returns without throwing. */
export function transact<T>(fn: (db: Db) => T): T {
  const draft = structuredClone(load());
  const result = fn(draft);
  g.__bgDb = draft;
  save(draft);
  return result;
}

/** Test helper. */
export function resetDb() {
  g.__bgDb = emptyDb();
}
