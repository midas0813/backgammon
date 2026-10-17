import type { MatchState } from "../../engine/match";
import type { ClockState } from "../clock";
import type { FairState } from "../fair";
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
  /** Experience points (changed only through users.addXp, never by put). */
  xp?: number;
  /** Chosen avatar frame (lib/quests.ts FRAMES). */
  frame?: string;
  /** Salted hashes of the network address at sign-up and last seen (anti-cheat; never the address). */
  createdIp?: string;
  lastIp?: string;
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
export type ClosedReason = "expired" | "host-missing" | "abandoned" | "inactive" | "ended";

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
  /**
   * Events added since the record was loaded; `put` appends them to the match's event log (read it
   * with `matches.events`). Loaded records start with none, so a move never rewrites the history.
   */
  events: StoredEvent[];
  eventSeq: number;
  /** New actionId → original response pairs, stored by `put` (read with `matches.action`). */
  actions: Record<string, { fingerprint: string; response: unknown }>;
  /** Host's choice; undefined (older matches) means allowed. */
  allowSpectators?: boolean;
  /** Host's choices for spectators (undefined = allowed): chat messages, emoji reactions. */
  spectatorChat?: boolean;
  spectatorEmoji?: boolean;
  /** Spectators the host removed: they can no longer watch or chat. */
  removedSpectators?: string[];
  /** Entry fee in token minor units; 0 or undefined = free. */
  entryFee?: number;
  completedAt?: string;
  /**
   * Why a match closed without a result: a table nobody joined ("expired"), a host who never came
   * back after someone joined ("host-missing"), an online match both players left ("abandoned"), a
   * computer or pass & play game left alone for a day ("inactive"), or one the player ended ("ended").
   */
  closedReason?: ClosedReason;
  /** When the second player sat down (ms). */
  startedAt?: number;
  /** Match clocks (online matches with a clock); absent = no clock. */
  clock?: ClockState;
  /** Provably fair dice (absent on matches created before it). */
  fair?: FairState;
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
  /** Seat that must act next, null when nobody (or unknown for rows saved before it was stored). */
  seatToAct: number | null;
  /** Clock preset ("none" for rows saved before clocks). */
  clock: string;
  allowSpectators: boolean;
  entryFee: number;
  hostSeenAt: number; // ms, 0 when never seen
  spectators: number; // seen within the store's spectator window
}

export const SPECTATOR_WINDOW_MS = 20_000;

export interface MatchResultRow {
  matchId: string;
  userId: string;
  mode: MatchMode;
  won: boolean;
  /** Points this player scored in the match. */
  points: number;
  games: number;
  /** Games this player won with a gammon or backgammon. */
  gammons: number;
  opponent: string;
  /** The opponent's account (null against the computer). */
  opponentId: string | null;
  /** Leaderboard points this result earned (0 when capped or not eligible). */
  lbPoints?: number;
  /** Under anti-cheat review: not counted for prizes until cleared. */
  flagged?: boolean;
  score: [number, number]; // this player's, then the opponent's
  targetPoints: number;
  endReason: string;
  completedAt: string;
}

export interface LeaderRow {
  userId: string;
  points: number;
  wins: number;
  played: number;
  opponents: number;
}

export interface PrizeWeek {
  weekKey: string;
  status: "PENDING_REVIEW" | "PAID" | "SKIPPED";
  poolUnits: number;
  winners: { userId: string; name: string; place: number; points: number; units: number }[];
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface CheatFlag {
  id: number;
  kind: string;
  dedupeKey: string;
  userIds: string[];
  matchIds: string[];
  details: Record<string, unknown>;
  status: "OPEN" | "DISMISSED" | "ACTIONED";
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface PlayerTotals {
  played: number;
  wins: number;
  points: number;
  games: number;
  gammons: number;
  currentStreak: number;
  bestStreak: number;
}

export interface PublicTableFilter {
  status: "WAITING" | "ACTIVE";
  points?: number;
  feeMin?: number;
  feeMax?: number;
  hostSeenSince: number;
  activeSince: number;
  sort: "newest" | "oldest";
  offset: number;
  limit: number;
}

export interface ChatMessage {
  id: number;
  matchId: string;
  userId: string;
  name: string;
  role: "player" | "spectator";
  kind: "text" | "preset" | "emoji";
  body: string;
  createdAt: string;
  removedAt?: string;
  removedBy?: string;
}

export interface AppError {
  id?: number;
  ref: string;
  source: "server" | "client";
  message: string;
  detail?: string;
  path?: string;
  userId?: string;
  createdAt: string;
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
  /** Run `fn` once this unit of work has committed (never if it fails), e.g. to notify watchers. */
  afterCommit(fn: () => void): void;
  users: {
    get(id: string): Promise<User | undefined>;
    getMany(ids: string[]): Promise<Record<string, User>>;
    byWallet(address: string): Promise<User | undefined>;
    put(user: User): Promise<void>;
    count(): Promise<number>;
    /** Record activity (for "players online"); callers throttle. */
    touchSeen(id: string, at: number, ipHash?: string): Promise<void>;
    /** Accounts created from this network (hash) since `since` (ms). */
    countCreatedFrom(ipHash: string, since: number): Promise<number>;
    /** The player closed the app: no longer counted online (last activity set to `at`, in the past). */
    markAway(id: string, at: number): Promise<void>;
    /** Add XP atomically; returns the new total. */
    addXp(id: string, n: number): Promise<number>;
    countSeenSince(at: number): Promise<number>;
    /**
     * Remove up to `limit` guests (no wallet) last active before `before` (ms) who are not in an
     * online game, with their computer, pass & play and unjoined games, results, reports and sessions.
     * Online matches they finished against others stay. Returns how many were removed.
     */
    deleteInactiveGuests(before: number, limit: number): Promise<number>;
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
    /** Saves the state and appends `rec.events` and `rec.actions` to their logs. */
    put(rec: MatchRecord): Promise<void>;
    /** Logged events after seq `after`, or the newest `last` of them, in order. */
    events(id: string, f: { after?: number; last?: number }): Promise<StoredEvent[]>;
    /** A stored action response, for idempotent retries. */
    action(id: string, actionId: string): Promise<{ fingerprint: string; response: unknown } | undefined>;
    /** The user's matches that are waiting or in progress, newest first. */
    listOpen(userId: string, limit: number): Promise<LobbyRow[]>;
    /**
     * Waiting tables to close: invite-only tables older than `privateBefore`, public tables whose host
     * was last seen before `hostSeenBefore` or that were opened before `publicBefore` (all ms).
     */
    staleTables(f: { privateBefore: number; hostSeenBefore: number; publicBefore: number; limit: number }): Promise<string[]>;
    /**
     * Matches in progress that may have been left (oldest change first): online matches unchanged since
     * `onlineBefore` with a player not seen since `awayBefore`, and computer / pass & play games
     * unchanged since `offlineBefore` (all ms).
     */
    idleActive(f: { onlineBefore: number; awayBefore: number; offlineBefore: number; limit: number }): Promise<string[]>;
    /** Matches in progress changed at or after `since` (ms). */
    countActiveSince(since: number): Promise<number>;
    /**
     * Public tables (mode quick) for the room browser, filtered and paged. WAITING tables only count
     * when the host was seen at or after `hostSeenSince`; ACTIVE ones only when watchable and updated
     * at or after `activeSince`.
     */
    listPublic(f: PublicTableFilter): Promise<{ rows: LobbyRow[]; total: number }>;
    /** Admin: any mode, optionally by status and/or player; newest activity first. */
    listAdmin(f: { status?: string; userId?: string; limit: number }): Promise<LobbyRow[]>;
    countCompletedSince(at: number): Promise<number>;
    /** Completed matches per UTC day, oldest first. */
    dailyCompleted(days: number): Promise<{ day: string; n: number }[]>;
  };
  /** One row per human player per finished match (A4): stats never load match documents. */
  results: {
    put(rows: MatchResultRow[]): Promise<void>;
    deleteForMatch(matchId: string): Promise<string[]>;
    stats(userId: string, since?: number): Promise<PlayerTotals>;
    history(userId: string, offset: number, limit: number): Promise<MatchResultRow[]>;
    /** Matches this user won (or, with `played`, played) against that opponent since `since` (ms). */
    countAgainst(userId: string, opponentId: string, since: number, opts?: { played?: boolean }): Promise<number>;
    /** Points per player in [since, until) (ms), best first. Flagged results are left out. */
    leaderboard(since: number, until: number, limit: number): Promise<LeaderRow[]>;
    /** One player's points, 1-based rank and distinct opponents in [since, until). */
    standing(userId: string, since: number, until: number): Promise<LeaderRow & { rank: number | null }>;
    /** Losses to that opponent since `since` that ended by one of `reasons` (forfeit, timeout, …). */
    countLostBy(userId: string, opponentId: string, since: number, reasons: string[]): Promise<number>;
    /** Mark or clear a match's results as under review. */
    setFlagged(matchId: string, flagged: boolean): Promise<void>;
  };
  chat: {
    add(m: Omit<ChatMessage, "id" | "createdAt">): Promise<ChatMessage>;
    /** Messages after id `after`, oldest first (at most `limit`, the newest ones when more). */
    list(matchId: string, after: number, limit: number): Promise<ChatMessage[]>;
    get(id: number): Promise<ChatMessage | undefined>;
    remove(id: number, by: string): Promise<void>;
  };
  errors: {
    add(e: Omit<AppError, "id" | "createdAt">): Promise<void>;
    recent(limit: number): Promise<AppError[]>;
    countSince(at: number): Promise<number>;
    /** Drop errors recorded before `before` (ms). */
    prune(before: number): Promise<void>;
  };
  rateLimits: {
    /** Count a hit in the window starting at `windowStart` (ms) and return the window's count. */
    hit(key: string, windowStart: number): Promise<number>;
    /** Drop windows that started before `before` (ms). */
    prune(before: number): Promise<void>;
  };
  quests: {
    /** Progress rows for these periods. */
    list(userId: string, periodKeys: string[]): Promise<{ periodKey: string; questId: string; progress: number; claimedAt?: string }[]>;
    /** Add to unclaimed quests' progress (capped at each target). */
    bump(userId: string, rows: { periodKey: string; questId: string; n: number; target: number }[]): Promise<void>;
    /** Mark a completed, unclaimed quest claimed; false if it was not claimable. */
    claim(userId: string, periodKey: string, questId: string, target: number): Promise<boolean>;
  };
  prizes: {
    get(weekKey: string, opts?: { lock?: boolean }): Promise<PrizeWeek | undefined>;
    put(w: PrizeWeek): Promise<void>;
    list(limit: number): Promise<PrizeWeek[]>;
  };
  flags: {
    /** Open a flag unless one with this dedupe key exists; returns its id when new. */
    add(f: Omit<CheatFlag, "id" | "status" | "createdAt">): Promise<number | null>;
    get(id: number, opts?: { lock?: boolean }): Promise<CheatFlag | undefined>;
    list(status: CheatFlag["status"] | undefined, limit: number): Promise<CheatFlag[]>;
    decide(id: number, status: "DISMISSED" | "ACTIONED", by: string, note: string): Promise<void>;
    countOpen(): Promise<number>;
  };
  /** Site-wide running totals (games played, …). */
  counters: {
    add(key: string, n: number): Promise<void>;
    get(keys: string[]): Promise<Record<string, number>>;
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
