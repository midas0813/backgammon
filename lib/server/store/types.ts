import type { MatchState } from "../../engine/match";
import type { DepositMethod, DepositStatus, WithdrawalStatus } from "../payments/adapter";

/** Accounts are wallet-based: one EVM address = one account. Guests have no wallet yet. */
export interface User {
  id: string;
  walletAddress?: string; // EIP-55 checksummed
  chainId?: number;
  name: string;
  themeId: string;
  reducedMotion: boolean;
  bio?: string;
  country?: string;
  avatar?: string;
  sound?: boolean;
  highContrast?: boolean;
  boardOrientation?: "right" | "left";
  createdAt: string;
  registeredAt?: string;
}

export interface Dispute {
  id: string;
  userId: string;
  matchId?: string;
  transactionId?: string;
  category: "GAME" | "PAYMENT" | "ACCOUNT" | "OTHER";
  reason: string;
  status: string;
  createdAt: string;
}

export interface Session {
  userId: string;
  createdAt: string;
  siweNonce?: string;
  siweNonceExpiresAt?: number;
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

export interface Entry {
  account: string;
  amount: number; // integer minor units, signed
}

export interface Txn {
  id: string;
  key: string;
  type: string;
  memo: string;
  createdAt: string;
  entries: Entry[];
}

export interface Avatar {
  file: string;
  userId: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * One unit of work. Everything read or written through a Tx commits together or not at all.
 * `lock: true` reads take a row lock (SELECT … FOR UPDATE) so concurrent writers serialise.
 */
export interface Tx {
  /** Serialise on an arbitrary key until commit (Postgres advisory lock; no-op in the serial memory store). */
  lock(key: string): Promise<void>;
  users: {
    get(id: string): Promise<User | undefined>;
    getMany(ids: string[]): Promise<Record<string, User>>;
    byWallet(address: string): Promise<User | undefined>;
    put(user: User): Promise<void>;
    count(): Promise<number>;
  };
  sessions: {
    get(token: string): Promise<Session | undefined>;
    put(token: string, session: Session): Promise<void>;
    delete(token: string): Promise<void>;
  };
  matches: {
    get(id: string, opts?: { lock?: boolean }): Promise<MatchRecord | undefined>;
    put(rec: MatchRecord): Promise<void>;
    /** Oldest waiting quick match with this length not created by `excludeUser`, locked for joining. */
    nextWaitingQuick(targetPoints: number, excludeUser: string): Promise<MatchRecord | undefined>;
    listForUser(userId: string): Promise<MatchRecord[]>;
    listOpenQuick(excludeUser: string): Promise<MatchRecord[]>;
    stats(): Promise<{ live: number; waiting: number; games: number }>;
  };
  idempotency: {
    get(key: string): Promise<{ fingerprint: string; response: unknown } | undefined>;
    put(key: string, value: { fingerprint: string; response: unknown }): Promise<void>;
  };
  deposits: {
    get(id: string): Promise<DepositIntent | undefined>;
    byRef(ref: string, opts?: { lock?: boolean }): Promise<DepositIntent | undefined>;
    put(d: DepositIntent): Promise<void>;
    listByUser(userId: string): Promise<DepositIntent[]>;
  };
  withdrawals: {
    get(id: string, opts?: { lock?: boolean }): Promise<Withdrawal | undefined>;
    byRef(ref: string, opts?: { lock?: boolean }): Promise<Withdrawal | undefined>;
    put(w: Withdrawal): Promise<void>;
    listByUser(userId: string): Promise<Withdrawal[]>;
  };
  paymentEvents: {
    get(eventId: string): Promise<{ outcome: string } | undefined>;
    put(eventId: string, outcome: string): Promise<void>;
  };
  ledger: {
    /** Current balances (0 when unknown); `lock` locks the rows until commit. */
    balances(accounts: string[], lock: boolean): Promise<Record<string, number>>;
    txnByKey(key: string): Promise<Txn | undefined>;
    insert(txn: Omit<Txn, "id">, newBalances: Record<string, number>): Promise<Txn>;
    userTransactions(userId: string, limit: number): Promise<Txn[]>;
    dump(): Promise<{ transactions: Txn[]; balances: Record<string, number> }>;
  };
  avatars: {
    put(a: Avatar): Promise<void>;
    get(file: string): Promise<Avatar | undefined>;
    delete(file: string): Promise<void>;
  };
  presence: {
    /** Record that `seat` polled `matchId` at `at` (ms). */
    touch(matchId: string, seat: number, at: number): Promise<void>;
    /** Last-seen time (ms) per seat; 0 when never seen. */
    get(matchId: string): Promise<[number, number]>;
  };
  disputes: {
    put(d: Dispute): Promise<void>;
    listByUser(userId: string): Promise<Dispute[]>;
  };
}

export interface Store {
  kind: "memory" | "postgres";
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
  /** Tests only. */
  reset(): Promise<void>;
}
