/**
 * Internal token ledger (spec 02-backend "Ledger and settlement", 06-payments-development).
 * Immutable, balanced journal transactions with idempotency keys; balances are derived and reconcilable.
 */
export type UserAccountKind = "FREE_CREDITS" | "PAID_AVAILABLE" | "PAID_MATCH_RESERVED" | "PAID_WITHDRAWAL_RESERVED";

export const SYSTEM = {
  externalClearing: "system:EXTERNAL_CLEARING",
  companyRevenue: "system:COMPANY_REVENUE",
  freeIssuance: "system:FREE_ISSUANCE",
  eventEscrow: "system:EVENT_ESCROW",
} as const;

// System sources may go negative (they mirror money/credits that originate outside the ledger).
const MAY_BE_NEGATIVE = new Set<string>([SYSTEM.externalClearing, SYSTEM.freeIssuance]);

export const userAccount = (userId: string, kind: UserAccountKind) => `user:${userId}:${kind}`;

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

export interface LedgerState {
  balances: Record<string, number>;
  transactions: Txn[];
  byKey: Record<string, string>;
}

export class LedgerError extends Error {
  constructor(public code: "INSUFFICIENT_BALANCE" | "UNBALANCED" | "INVALID_AMOUNT", message: string) {
    super(message);
  }
}

export const emptyLedger = (): LedgerState => ({ balances: {}, transactions: [], byKey: {} });

export const balance = (l: LedgerState, account: string) => l.balances[account] ?? 0;

/**
 * Post a transaction once per idempotency key. A repeat with the same key returns the original
 * transaction without applying it again.
 */
export function post(l: LedgerState, key: string, type: string, entries: Entry[], memo = ""): Txn {
  const existing = l.byKey[key];
  if (existing) return l.transactions.find((t) => t.id === existing)!;

  const clean = entries.filter((e) => e.amount !== 0);
  for (const e of clean) {
    if (!Number.isInteger(e.amount)) throw new LedgerError("INVALID_AMOUNT", "Amounts must be integer minor units");
  }
  if (clean.reduce((s, e) => s + e.amount, 0) !== 0) throw new LedgerError("UNBALANCED", "Transaction does not balance");

  const next: Record<string, number> = {};
  for (const e of clean) next[e.account] = (next[e.account] ?? balance(l, e.account)) + e.amount;
  for (const [account, value] of Object.entries(next)) {
    if (value < 0 && !MAY_BE_NEGATIVE.has(account)) {
      throw new LedgerError("INSUFFICIENT_BALANCE", "Insufficient balance");
    }
  }

  const txn: Txn = {
    id: `txn_${l.transactions.length + 1}`,
    key,
    type,
    memo,
    createdAt: new Date().toISOString(),
    entries: clean,
  };
  Object.assign(l.balances, next);
  l.transactions.push(txn);
  l.byKey[key] = txn.id;
  return txn;
}

/** Recompute every balance from the journal; returns accounts whose derived balance disagrees. */
export function reconcile(l: LedgerState): string[] {
  const derived: Record<string, number> = {};
  for (const t of l.transactions) {
    if (t.entries.reduce((s, e) => s + e.amount, 0) !== 0) return [`unbalanced:${t.id}`];
    for (const e of t.entries) derived[e.account] = (derived[e.account] ?? 0) + e.amount;
  }
  const accounts = new Set([...Object.keys(derived), ...Object.keys(l.balances)]);
  return [...accounts].filter((a) => (derived[a] ?? 0) !== (l.balances[a] ?? 0));
}

// ---- Domain operations ------------------------------------------------------------------------

export function grantFreeCredits(l: LedgerState, userId: string, units: number) {
  return post(l, `free-grant:${userId}`, "FREE_GRANT", [
    { account: SYSTEM.freeIssuance, amount: -units },
    { account: userAccount(userId, "FREE_CREDITS"), amount: units },
  ], "Practice credits (no cash value)");
}

export function creditDeposit(l: LedgerState, userId: string, intentId: string, units: number) {
  return post(l, `deposit:${intentId}`, "DEPOSIT_CREDIT", [
    { account: SYSTEM.externalClearing, amount: -units },
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
  ], `Deposit ${intentId}`);
}

export function reserveForMatch(l: LedgerState, userId: string, matchKey: string, units: number) {
  return post(l, `match-reserve:${matchKey}:${userId}`, "MATCH_RESERVE", [
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: -units },
    { account: userAccount(userId, "PAID_MATCH_RESERVED"), amount: units },
  ]);
}

export function releaseMatchReserve(l: LedgerState, userId: string, matchKey: string, units: number) {
  return post(l, `match-release:${matchKey}:${userId}`, "MATCH_RELEASE", [
    { account: userAccount(userId, "PAID_MATCH_RESERVED"), amount: -units },
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
  ]);
}

/** Tokens-per-point settlement: loser pays G from reserve R, winner pays fee F on G. One per match. */
export function settleTokensPerPoint(
  l: LedgerState,
  a: { matchKey: string; winner: string; loser: string; reserve: number; gross: number; fee: number },
) {
  if (a.gross > a.reserve) throw new LedgerError("INVALID_AMOUNT", "Transfer cannot exceed reserve");
  return post(l, `settle:${a.matchKey}`, "MATCH_SETTLEMENT_PER_POINT", [
    { account: userAccount(a.loser, "PAID_MATCH_RESERVED"), amount: -a.reserve },
    { account: userAccount(a.loser, "PAID_AVAILABLE"), amount: a.reserve - a.gross },
    { account: userAccount(a.winner, "PAID_MATCH_RESERVED"), amount: -a.reserve },
    { account: userAccount(a.winner, "PAID_AVAILABLE"), amount: a.reserve + a.gross - a.fee },
    { account: SYSTEM.companyRevenue, amount: a.fee },
  ]);
}

/** Fixed-stake settlement: both stakes S form the pool; winner receives 2S − F. One per match. */
export function settleFixedStake(
  l: LedgerState,
  a: { matchKey: string; winner: string; loser: string; stake: number; fee: number },
) {
  return post(l, `settle:${a.matchKey}`, "MATCH_SETTLEMENT_FIXED", [
    { account: userAccount(a.loser, "PAID_MATCH_RESERVED"), amount: -a.stake },
    { account: userAccount(a.winner, "PAID_MATCH_RESERVED"), amount: -a.stake },
    { account: userAccount(a.winner, "PAID_AVAILABLE"), amount: 2 * a.stake - a.fee },
    { account: SYSTEM.companyRevenue, amount: a.fee },
  ]);
}

export function reserveWithdrawal(l: LedgerState, userId: string, withdrawalId: string, units: number) {
  return post(l, `withdrawal-reserve:${withdrawalId}`, "WITHDRAWAL_RESERVE", [
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: -units },
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: units },
  ]);
}

export function releaseWithdrawal(l: LedgerState, userId: string, withdrawalId: string, units: number) {
  return post(l, `withdrawal-release:${withdrawalId}`, "WITHDRAWAL_RELEASE", [
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: -units },
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
  ]);
}

export function completeWithdrawal(l: LedgerState, userId: string, withdrawalId: string, units: number) {
  return post(l, `withdrawal-paid:${withdrawalId}`, "WITHDRAWAL_PAID", [
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: -units },
    { account: SYSTEM.externalClearing, amount: units },
  ]);
}

export function userBalances(l: LedgerState, userId: string) {
  return {
    freeCredits: balance(l, userAccount(userId, "FREE_CREDITS")),
    available: balance(l, userAccount(userId, "PAID_AVAILABLE")),
    matchReserved: balance(l, userAccount(userId, "PAID_MATCH_RESERVED")),
    withdrawalReserved: balance(l, userAccount(userId, "PAID_WITHDRAWAL_RESERVED")),
  };
}

export function userTransactions(l: LedgerState, userId: string): Txn[] {
  const prefix = `user:${userId}:`;
  return l.transactions
    .filter((t) => t.entries.some((e) => e.account.startsWith(prefix)))
    .map((t) => ({ ...t, entries: t.entries.filter((e) => e.account.startsWith(prefix)) }));
}
