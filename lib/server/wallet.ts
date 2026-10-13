import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { read, transact, type Db, type DepositIntent, type Withdrawal } from "./db";
import { ApiError, notFound } from "./errors";
import {
  completeWithdrawal,
  creditDeposit,
  LedgerError,
  releaseWithdrawal,
  reserveWithdrawal,
  userBalances,
  userTransactions,
} from "./ledger";
import type { DepositMethod, NormalizedPaymentEvent, WithdrawalStatus } from "./payments/adapter";
import { simulatedAdapter } from "./payments/simulated";

/** The active adapter. Swap for a real provider adapter once one is approved (spec 06). */
export const paymentAdapter = simulatedAdapter;

const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_PURCHASE_TOKENS = 5000;
export const SIMULATED_STABLECOINS = [{ asset: "USDC", network: "sim-chain", decimals: 6, finality: "12 blocks (simulated)" }];

/** Wraps an action with an idempotency key so a retried request returns its original response. */
function idempotent<T>(db: Db, scope: string, actionId: unknown, fingerprint: unknown, fn: () => T): T {
  if (typeof actionId !== "string" || !actionId) throw new ApiError(400, "INVALID_INPUT", "actionId is required");
  const key = `${scope}:${actionId}`;
  const fp = JSON.stringify(fingerprint);
  const prior = db.idempotency[key];
  if (prior) {
    if (prior.fingerprint !== fp) throw new ApiError(409, "DUPLICATE_ACTION_CONFLICT", "actionId reused with a different payload");
    return prior.response as T;
  }
  const response = fn();
  db.idempotency[key] = { fingerprint: fp, response };
  return response;
}

function ledgerToApi(e: unknown): never {
  if (e instanceof LedgerError) throw new ApiError(422, e.code, e.message);
  throw e;
}

export function getWallet(userId: string) {
  return read((db) => {
    const deposits = Object.values(db.deposits)
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const withdrawals = Object.values(db.withdrawals)
      .filter((w) => w.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pendingDeposits = deposits
      .filter((d) => d.status === "PENDING" || d.status === "CONFIRMED")
      .reduce((s, d) => s + d.tokenUnits, 0);
    return {
      scale: TOKEN_SCALE,
      tokenCode: "BGT",
      usdPerToken: 1,
      balances: { ...userBalances(db.ledger, userId), pendingDeposits },
      deposits,
      withdrawals,
      transactions: userTransactions(db.ledger, userId).reverse().slice(0, 50),
      adapter: paymentAdapter.id,
      stablecoins: SIMULATED_STABLECOINS,
    };
  });
}

export async function createPurchaseIntent(userId: string, body: { quantity?: unknown; method?: unknown; actionId?: unknown }) {
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PURCHASE_TOKENS) {
    throw new ApiError(400, "INVALID_INPUT", `Quantity must be a whole number from 1 to ${MAX_PURCHASE_TOKENS}`);
  }
  const method = body.method === "STABLECOIN" ? "STABLECOIN" : ("CARD" as DepositMethod);
  const intentId = `dep_${randomUUID().slice(0, 8)}`;
  const stable = method === "STABLECOIN" ? SIMULATED_STABLECOINS[0] : undefined;
  const provider = await paymentAdapter.createDepositIntent({
    intentId,
    tokenUnits: quantity * TOKEN_SCALE,
    method,
    asset: stable?.asset,
    network: stable?.network,
  });
  return transact((db) =>
    idempotent(db, `purchase:${userId}`, body.actionId, [quantity, method], () => {
      const now = new Date();
      const intent: DepositIntent = {
        id: intentId,
        userId,
        method,
        asset: stable?.asset,
        network: stable?.network,
        tokenUnits: quantity * TOKEN_SCALE,
        usdCents: quantity * 100,
        feeCents: 0, // provider/network fees are quoted separately and never change credited tokens
        rate: "1 BGT = 1.00 USD",
        status: "CREATED",
        externalRef: provider.externalRef,
        instructions: provider.instructions,
        expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
        createdAt: now.toISOString(),
        history: [{ status: "CREATED", at: now.toISOString() }],
      };
      db.deposits[intent.id] = intent;
      return intent;
    }),
  );
}

const DEPOSIT_RANK: Record<string, number> = { CREATED: 0, PENDING: 1, CONFIRMED: 2, CREDITED: 3 };
const WITHDRAWAL_FLOW: WithdrawalStatus[] = ["REQUESTED", "PENDING_REVIEW", "APPROVED", "PROCESSING", "PAID"];
const WITHDRAWAL_TERMINAL = new Set<WithdrawalStatus>(["PAID", "REJECTED", "CANCELLED", "FAILED"]);

/**
 * Apply one normalized provider event exactly once. Duplicates are acknowledged without effect;
 * out-of-order events never move a deposit backwards.
 */
export function processPaymentEvent(event: NormalizedPaymentEvent) {
  return transact((db) => {
    if (db.paymentEvents[event.eventId]) return { duplicate: true, outcome: db.paymentEvents[event.eventId].outcome };
    const at = new Date().toISOString();
    let outcome: string;
    if (event.kind === "DEPOSIT") outcome = applyDepositEvent(db, event, at);
    else outcome = applyWithdrawalEvent(db, event, at);
    db.paymentEvents[event.eventId] = { processedAt: at, outcome };
    return { duplicate: false, outcome };
  });
}

function applyDepositEvent(db: Db, event: NormalizedPaymentEvent, at: string): string {
  const intent = Object.values(db.deposits).find((d) => d.externalRef === event.externalRef);
  if (!intent) return "UNMATCHED_FOR_REVIEW";
  const note = (status: string, n?: string) => intent.history.push({ status, at, eventId: event.eventId, note: n });
  const current = intent.status;
  const terminal = current === "FAILED" || current === "EXPIRED" || current === "REVIEW";

  if (event.status === "PENDING" || event.status === "CONFIRMED") {
    if (terminal) {
      note(current, `Ignored ${event.status} after ${current}; manual review`);
      return "IGNORED_TERMINAL";
    }
    if (DEPOSIT_RANK[event.status] <= DEPOSIT_RANK[current]) {
      note(current, `Ignored late ${event.status}`);
      return "IGNORED_OUT_OF_ORDER";
    }
    if (event.status === "PENDING") {
      intent.status = "PENDING";
      note("PENDING");
      return "PENDING";
    }
    if (event.amountUnits !== intent.tokenUnits) {
      intent.status = "REVIEW";
      note("REVIEW", `Amount mismatch: expected ${intent.tokenUnits}, received ${event.amountUnits}`);
      return "REVIEW";
    }
    intent.status = "CONFIRMED";
    note("CONFIRMED");
    creditDeposit(db.ledger, intent.userId, intent.id, intent.tokenUnits);
    intent.status = "CREDITED";
    note("CREDITED");
    return "CREDITED";
  }
  if (event.status === "FAILED" || event.status === "EXPIRED") {
    if (current === "CREDITED") {
      intent.status = "REVIEW";
      note("REVIEW", `${event.status} received after credit; reversal requires review`);
      return "REVIEW";
    }
    if (terminal) return "IGNORED_TERMINAL";
    intent.status = event.status;
    note(event.status);
    return event.status;
  }
  return "IGNORED_UNKNOWN_STATUS";
}

function applyWithdrawalEvent(db: Db, event: NormalizedPaymentEvent, at: string): string {
  const w = Object.values(db.withdrawals).find((x) => x.externalRef === event.externalRef);
  if (!w) return "UNMATCHED_FOR_REVIEW";
  const status = event.status as WithdrawalStatus;
  if (WITHDRAWAL_TERMINAL.has(w.status)) {
    w.history.push({ status: w.status, at, eventId: event.eventId, note: `Ignored ${status} after ${w.status}` });
    return "IGNORED_TERMINAL";
  }
  if (status === "REJECTED" || status === "FAILED") {
    releaseWithdrawal(db.ledger, w.userId, w.id, w.amountUnits);
  } else if (status === "PAID") {
    completeWithdrawal(db.ledger, w.userId, w.id, w.amountUnits);
  } else if (WITHDRAWAL_FLOW.indexOf(status) <= WITHDRAWAL_FLOW.indexOf(w.status)) {
    w.history.push({ status: w.status, at, eventId: event.eventId, note: `Ignored late ${status}` });
    return "IGNORED_OUT_OF_ORDER";
  }
  w.status = status;
  w.history.push({ status, at, eventId: event.eventId });
  return status;
}

export async function requestWithdrawal(userId: string, body: { amount?: unknown; destination?: unknown; actionId?: unknown }) {
  const tokens = Number(body.amount);
  if (!Number.isInteger(tokens) || tokens < 1) throw new ApiError(400, "INVALID_INPUT", "Amount must be a whole number of tokens");
  const destination = typeof body.destination === "string" ? body.destination.slice(0, 40) : "Simulated bank account";
  const withdrawalId = `wd_${randomUUID().slice(0, 8)}`;
  const { externalRef } = await paymentAdapter.requestWithdrawal({ withdrawalId, amountUnits: tokens * TOKEN_SCALE, destination });
  return transact((db) =>
    idempotent(db, `withdraw:${userId}`, body.actionId, [tokens, destination], () => {
      const units = tokens * TOKEN_SCALE;
      try {
        // Only PAID_AVAILABLE can fund this; free credits and match reserves are separate accounts.
        reserveWithdrawal(db.ledger, userId, withdrawalId, units);
      } catch (e) {
        ledgerToApi(e);
      }
      const now = new Date().toISOString();
      const w: Withdrawal = {
        id: withdrawalId,
        userId,
        amountUnits: units,
        destination,
        status: "PENDING_REVIEW",
        externalRef,
        createdAt: now,
        history: [
          { status: "REQUESTED", at: now },
          { status: "PENDING_REVIEW", at: now },
        ],
      };
      db.withdrawals[w.id] = w;
      return w;
    }),
  );
}

export function cancelWithdrawal(userId: string, withdrawalId: string) {
  return transact((db) => {
    const w = db.withdrawals[withdrawalId];
    if (!w || w.userId !== userId) throw notFound("Withdrawal");
    if (w.status === "CANCELLED") return w;
    // Cancellable only while the provider is guaranteed not to have sent funds.
    if (w.status !== "REQUESTED" && w.status !== "PENDING_REVIEW") {
      throw new ApiError(409, "WRONG_PHASE", "This withdrawal can no longer be cancelled");
    }
    releaseWithdrawal(db.ledger, userId, w.id, w.amountUnits);
    w.status = "CANCELLED";
    w.history.push({ status: "CANCELLED", at: new Date().toISOString() });
    return w;
  });
}

export function findOwnedPaymentObject(userId: string, kind: "DEPOSIT" | "WITHDRAWAL", id: string) {
  return read((db) => {
    const obj = kind === "DEPOSIT" ? db.deposits[id] : db.withdrawals[id];
    if (!obj || obj.userId !== userId) throw notFound(kind === "DEPOSIT" ? "Deposit" : "Withdrawal");
    return obj;
  });
}
