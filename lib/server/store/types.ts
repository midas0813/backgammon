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
  status?: "active" | "suspended";
  /** ISO; absent = until lifted. */
  suspendedUntil?: string;
  suspendedReason?: string;
}

/** A user as the admin area lists them. */
export interface UserRow extends User {
  lastSeenAt?: string;
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
  assignedTo?: string;
  resolution?: string;
  updatedAt?: string;
}

export interface DisputeNote {
  id?: number;
  disputeId: string;
  authorId: string;
  note: string;
  createdAt: string;
}

export type AdminRole = "owner" | "operator" | "finance" | "viewer";

export interface AdminRoleRow {
  userId: string;
  role: AdminRole;
  grantedBy?: string;
  grantedAt: string;
}

export interface AdminSession {
  token: string;
  userId: string;
  createdAt: number; // ms
  lastSeenAt: number; // ms
  ip?: string;
  userAgent?: string;
}

export interface AdminChallenge {
  nonce: string;
  userId: string;
  purpose: string;
  message: string;
  details: Record<string, unknown>;
  expiresAt: number; // ms
  usedAt?: number;
}

export interface AuditEntry {
  id?: number;
  at: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  details: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  signature?: string;
}

export interface Announcement {
  id: string;
  message: string;
  tone: "info" | "warn" | "ok";
  active: boolean;
  createdAt: string;
  createdBy?: string;
  expiresAt?: string;
}

export interface Adjustment {
  id: string;
  userId: string;
  accountKind: "PAID_AVAILABLE" | "FREE_CREDITS";
  amount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  txnKey?: string;
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
  /** Host's choice; undefined (older matches) means allowed. */
  allowSpectators?: boolean;
  completedAt?: string;
  /** Why a WAITING table closed without the host cancelling it. */
  closedReason?: "expired";
  voided?: { by: string; reason: string; at: string };
}

/** What lobby lists need about a match, without the full document. */
export interface LobbyRow {
  id: string;
  mode: MatchMode;
  status: string;
  targetPoints: number;
  createdAt: string;
  updatedAt: number; // ms
  hostId: string;
  seats: [string | null, string | null];
  names: [string, string];
  score: [number, number];
  cube: number;
  gameNumber: number;
  allowSpectators: boolean;
  hostSeenAt: number; // ms, 0 when never seen
  spectators: number; // seen within the store's spectator window
}

export const SPECTATOR_WINDOW_MS = 20_000;

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
    /** Record activity (for "players online"); callers throttle. */
    touchSeen(id: string, at: number): Promise<void>;
    countSeenSince(at: number): Promise<number>;
    /** Admin: by id, wallet or name (case-insensitive substring); newest first. */
    search(query: string, limit: number): Promise<UserRow[]>;
    countCreatedSince(at: number): Promise<number>;
    countRegistered(): Promise<number>;
    /** New users per UTC day, oldest first, for the last `days` days. */
    dailyNew(days: number): Promise<{ day: string; n: number }[]>;
  };
  sessions: {
    get(token: string): Promise<Session | undefined>;
    put(token: string, session: Session): Promise<void>;
    delete(token: string): Promise<void>;
    deleteForUser(userId: string): Promise<number>;
  };
  matches: {
    get(id: string, opts?: { lock?: boolean }): Promise<MatchRecord | undefined>;
    put(rec: MatchRecord): Promise<void>;
    /**
     * Oldest public table with this length not hosted by `excludeUser` whose host was seen at or after
     * `hostSeenSince` (ms), locked for joining.
     */
    nextWaitingQuick(targetPoints: number, excludeUser: string, hostSeenSince: number): Promise<MatchRecord | undefined>;
    listForUser(userId: string): Promise<MatchRecord[]>;
    /** Public tables (mode quick) in a status, newest activity first for ACTIVE, oldest first for WAITING. */
    listLobby(status: "WAITING" | "ACTIVE", limit: number): Promise<LobbyRow[]>;
    stats(): Promise<{ live: number; waiting: number; games: number }>;
    /** Admin: any mode, optionally by status and/or player; newest activity first. */
    listAdmin(f: { status?: string; userId?: string; limit: number }): Promise<LobbyRow[]>;
    countCompletedSince(at: number): Promise<number>;
    /** Completed matches per UTC day, oldest first. */
    dailyCompleted(days: number): Promise<{ day: string; n: number }[]>;
  };
  spectators: {
    touch(matchId: string, userId: string, at: number): Promise<void>;
    count(matchId: string, since: number): Promise<number>;
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
    listAll(f: { status?: string; limit: number }): Promise<DepositIntent[]>;
  };
  withdrawals: {
    get(id: string, opts?: { lock?: boolean }): Promise<Withdrawal | undefined>;
    byRef(ref: string, opts?: { lock?: boolean }): Promise<Withdrawal | undefined>;
    put(w: Withdrawal): Promise<void>;
    listByUser(userId: string): Promise<Withdrawal[]>;
    listAll(f: { status?: string; limit: number }): Promise<Withdrawal[]>;
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
    get(id: string): Promise<Dispute | undefined>;
    update(d: Dispute): Promise<void>;
    listAll(f: { status?: string; limit: number }): Promise<Dispute[]>;
    countOpen(): Promise<number>;
    addNote(n: DisputeNote): Promise<void>;
    notes(disputeId: string): Promise<DisputeNote[]>;
  };
  admin: {
    activeRole(userId: string): Promise<AdminRoleRow | undefined>;
    /** True if the user ever held a role (bootstrap applies only to wallets that never did). */
    everHadRole(userId: string): Promise<boolean>;
    listRoles(): Promise<AdminRoleRow[]>;
    /** Replaces the user's active role. */
    grantRole(userId: string, role: AdminRole, by: string | null): Promise<void>;
    revokeRole(userId: string, by: string): Promise<void>;
    putSession(s: AdminSession): Promise<void>;
    getSession(token: string): Promise<AdminSession | undefined>;
    touchSession(token: string, at: number): Promise<void>;
    deleteSession(token: string): Promise<void>;
    deleteSessionsForUser(userId: string): Promise<void>;
    putChallenge(c: AdminChallenge): Promise<void>;
    /** Marks the challenge used and returns it, if it exists, belongs to `userId`, is unused and unexpired. */
    takeChallenge(nonce: string, userId: string, at: number): Promise<AdminChallenge | undefined>;
    audit(e: AuditEntry): Promise<void>;
    listAudit(f: { actorId?: string; targetType?: string; targetId?: string; limit: number }): Promise<AuditEntry[]>;
    getSetting<T = unknown>(key: string): Promise<T | undefined>;
    allSettings(): Promise<Record<string, unknown>>;
    putSetting(key: string, value: unknown, by: string): Promise<void>;
    listAnnouncements(): Promise<Announcement[]>;
    putAnnouncement(a: Announcement): Promise<void>;
    putAdjustment(a: Adjustment): Promise<void>;
    getAdjustment(id: string, opts?: { lock?: boolean }): Promise<Adjustment | undefined>;
    listAdjustments(status?: string): Promise<Adjustment[]>;
  };
}

export interface Store {
  kind: "memory" | "postgres";
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
  /** Tests only. */
  reset(): Promise<void>;
}
