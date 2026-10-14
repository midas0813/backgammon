/**
 * Internal token ledger (spec 02-backend "Ledger and settlement", 06-payments-development).
 * Immutable, balanced journal transactions with idempotency keys; balances are derived and reconcilable.
 */
import type { Entry, Tx, Txn } from "./store";

export type UserAccountKind = "FREE_CREDITS" | "PAID_AVAILABLE" | "PAID_MATCH_RESERVED" | "PAID_WITHDRAWAL_RESERVED";
export type { Entry, Txn };

export const SYSTEM = {
  externalClearing: "system:EXTERNAL_CLEARING",
  companyRevenue: "system:COMPANY_REVENUE",
  freeIssuance: "system:FREE_ISSUANCE",
  eventEscrow: "system:EVENT_ESCROW",
} as const;

// System sources may go negative (they mirror money/credits that originate outside the ledger).
const MAY_BE_NEGATIVE = new Set<string>([SYSTEM.externalClearing, SYSTEM.freeIssuance]);

export const userAccount = (userId: string, kind: UserAccountKind) => `user:${userId}:${kind}`;

export class LedgerError extends Error {
  constructor(public code: "INSUFFICIENT_BALANCE" | "UNBALANCED" | "INVALID_AMOUNT", message: string) {
    super(message);
  }
}

/**
 * Post a transaction once per idempotency key. A repeat with the same key returns the original
 * transaction without applying it again. Affected balances are row-locked until commit.
 */
export async function post(t: Tx, key: string, type: string, entries: Entry[], memo = ""): Promise<Txn> {
  const existing = await t.ledger.txnByKey(key);
  if (existing) return existing;

  const clean = entries.filter((e) => e.amount !== 0);
  for (const e of clean) {
    if (!Number.isSafeInteger(e.amount)) throw new LedgerError("INVALID_AMOUNT", "Amounts must be integer minor units");
  }
  if (clean.reduce((s, e) => s + e.amount, 0) !== 0) throw new LedgerError("UNBALANCED", "Transaction does not balance");

  const accounts = [...new Set(clean.map((e) => e.account))];
  const current = await t.ledger.balances(accounts, true);
  const next: Record<string, number> = { ...current };
  for (const e of clean) next[e.account] += e.amount;
  for (const [account, value] of Object.entries(next)) {
    if (value < 0 && !MAY_BE_NEGATIVE.has(account)) throw new LedgerError("INSUFFICIENT_BALANCE", "Insufficient balance");
  }
  return t.ledger.insert({ key, type, memo, createdAt: new Date().toISOString(), entries: clean }, next);
}

/** Recompute every balance from the journal; returns accounts whose stored balance disagrees. */
export async function reconcile(t: Tx): Promise<string[]> {
  const { transactions, balances } = await t.ledger.dump();
  const derived: Record<string, number> = {};
  for (const txn of transactions) {
    if (txn.entries.reduce((s, e) => s + e.amount, 0) !== 0) return [`unbalanced:${txn.id}`];
    for (const e of txn.entries) derived[e.account] = (derived[e.account] ?? 0) + e.amount;
  }
  const accounts = new Set([...Object.keys(derived), ...Object.keys(balances)]);
  return [...accounts].filter((a) => (derived[a] ?? 0) !== (balances[a] ?? 0));
}

// ---- Domain operations ------------------------------------------------------------------------

export function grantFreeCredits(t: Tx, userId: string, units: number) {
  return post(
    t,
    `free-grant:${userId}`,
    "FREE_GRANT",
    [
      { account: SYSTEM.freeIssuance, amount: -units },
      { account: userAccount(userId, "FREE_CREDITS"), amount: units },
    ],
    "Practice credits (no cash value)",
  );
}

export function creditDeposit(t: Tx, userId: string, intentId: string, units: number) {
  return post(
    t,
    `deposit:${intentId}`,
    "DEPOSIT_CREDIT",
    [
      { account: SYSTEM.externalClearing, amount: -units },
      { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
    ],
    `Deposit ${intentId}`,
  );
}

export function reserveForMatch(t: Tx, userId: string, matchKey: string, units: number) {
  return post(t, `match-reserve:${matchKey}:${userId}`, "MATCH_RESERVE", [
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: -units },
    { account: userAccount(userId, "PAID_MATCH_RESERVED"), amount: units },
  ]);
}

export function releaseMatchReserve(t: Tx, userId: string, matchKey: string, units: number) {
  return post(t, `match-release:${matchKey}:${userId}`, "MATCH_RELEASE", [
    { account: userAccount(userId, "PAID_MATCH_RESERVED"), amount: -units },
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
  ]);
}

/** Tokens-per-point settlement: loser pays G from reserve R, winner pays fee F on G. One per match. */
export function settleTokensPerPoint(
  t: Tx,
  a: { matchKey: string; winner: string; loser: string; reserve: number; gross: number; fee: number },
) {
  if (a.gross > a.reserve) throw new LedgerError("INVALID_AMOUNT", "Transfer cannot exceed reserve");
  return post(t, `settle:${a.matchKey}`, "MATCH_SETTLEMENT_PER_POINT", [
    { account: userAccount(a.loser, "PAID_MATCH_RESERVED"), amount: -a.reserve },
    { account: userAccount(a.loser, "PAID_AVAILABLE"), amount: a.reserve - a.gross },
    { account: userAccount(a.winner, "PAID_MATCH_RESERVED"), amount: -a.reserve },
    { account: userAccount(a.winner, "PAID_AVAILABLE"), amount: a.reserve + a.gross - a.fee },
    { account: SYSTEM.companyRevenue, amount: a.fee },
  ]);
}

/** Fixed-stake settlement: both stakes S form the pool; winner receives 2S − F. One per match. */
export function settleFixedStake(t: Tx, a: { matchKey: string; winner: string; loser: string; stake: number; fee: number }) {
  return post(t, `settle:${a.matchKey}`, "MATCH_SETTLEMENT_FIXED", [
    { account: userAccount(a.loser, "PAID_MATCH_RESERVED"), amount: -a.stake },
    { account: userAccount(a.winner, "PAID_MATCH_RESERVED"), amount: -a.stake },
    { account: userAccount(a.winner, "PAID_AVAILABLE"), amount: 2 * a.stake - a.fee },
    { account: SYSTEM.companyRevenue, amount: a.fee },
  ]);
}

export function reserveWithdrawal(t: Tx, userId: string, withdrawalId: string, units: number) {
  return post(t, `withdrawal-reserve:${withdrawalId}`, "WITHDRAWAL_RESERVE", [
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: -units },
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: units },
  ]);
}

export function releaseWithdrawal(t: Tx, userId: string, withdrawalId: string, units: number) {
  return post(t, `withdrawal-release:${withdrawalId}`, "WITHDRAWAL_RELEASE", [
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: -units },
    { account: userAccount(userId, "PAID_AVAILABLE"), amount: units },
  ]);
}

export function completeWithdrawal(t: Tx, userId: string, withdrawalId: string, units: number) {
  return post(t, `withdrawal-paid:${withdrawalId}`, "WITHDRAWAL_PAID", [
    { account: userAccount(userId, "PAID_WITHDRAWAL_RESERVED"), amount: -units },
    { account: SYSTEM.externalClearing, amount: units },
  ]);
}

export async function userBalances(t: Tx, userId: string) {
  const kinds: UserAccountKind[] = ["FREE_CREDITS", "PAID_AVAILABLE", "PAID_MATCH_RESERVED", "PAID_WITHDRAWAL_RESERVED"];
  const b = await t.ledger.balances(
    kinds.map((k) => userAccount(userId, k)),
    false,
  );
  return {
    freeCredits: b[userAccount(userId, "FREE_CREDITS")],
    available: b[userAccount(userId, "PAID_AVAILABLE")],
    matchReserved: b[userAccount(userId, "PAID_MATCH_RESERVED")],
    withdrawalReserved: b[userAccount(userId, "PAID_WITHDRAWAL_RESERVED")],
  };
}

/** Owner-only view: entries on other accounts (counterparties, revenue) are stripped. */
export async function userTransactions(t: Tx, userId: string, limit = 50): Promise<Txn[]> {
  const prefix = `user:${userId}:`;
  const txns = await t.ledger.userTransactions(userId, limit);
  return txns.map((x) => ({ ...x, entries: x.entries.filter((e) => e.account.startsWith(prefix)) }));
}
