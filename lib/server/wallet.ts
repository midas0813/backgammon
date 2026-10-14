import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "../fees";
import { ApiError, notFound } from "./errors";
import {
  LedgerError,
  completeWithdrawal,
  creditDeposit,
  releaseWithdrawal,
  reserveWithdrawal,
  userBalances,
  userTransactions,
} from "./ledger";
import type { DepositMethod, NormalizedPaymentEvent, WithdrawalStatus } from "./payments/adapter";
import { simulatedAdapter } from "./payments/simulated";
import { tx, type DepositIntent, type Tx, type Withdrawal } from "./store";

/** The active adapter. Swap for a real provider adapter once one is approved (spec 06). */
export const paymentAdapter = simulatedAdapter;

const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_PURCHASE_TOKENS = 5000;
export const SIMULATED_STABLECOINS = [{ asset: "USDC", network: "sim-chain", decimals: 6, finality: "12 blocks (simulated)" }];

/** Runs `fn` once per (scope, actionId); a retry with the same payload returns the original response. */
async function idempotent<T>(t: Tx, scope: string, actionId: unknown, fingerprint: unknown, fn: () => Promise<T>): Promise<T> {
  if (typeof actionId !== "string" || !actionId || actionId.length > 64) throw new ApiError(400, "INVALID_INPUT", "actionId is required");
  const key = `${scope}:${actionId}`;
  const fp = JSON.stringify(fingerprint);
  const prior = await t.idempotency.get(key);
  if (prior) {
    if (prior.fingerprint !== fp) throw new ApiError(409, "DUPLICATE_ACTION_CONFLICT", "actionId reused with a different payload");
    return prior.response as T;
  }
  const response = await fn();
  await t.idempotency.put(key, { fingerprint: fp, response });
  return response;
}

function ledgerToApi(e: unknown): never {
  if (e instanceof LedgerError) throw new ApiError(422, e.code, e.message);
  throw e;
}

export function getWallet(userId: string) {
  return tx(async (t) => {
    const deposits = await t.deposits.listByUser(userId);
    const withdrawals = await t.withdrawals.listByUser(userId);
    const pendingDeposits = deposits
      .filter((d) => d.status === "PENDING" || d.status === "CONFIRMED")
      .reduce((s, d) => s + d.tokenUnits, 0);
    return {
      scale: TOKEN_SCALE,
      tokenCode: "BGT",
      usdPerToken: 1,
      balances: { ...(await userBalances(t, userId)), pendingDeposits },
      deposits,
      withdrawals,
      transactions: await userTransactions(t, userId, 50),
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
  return tx((t) =>
    idempotent(t, `purchase:${userId}`, body.actionId, [quantity, method], async () => {
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
      await t.deposits.put(intent);
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
  return tx(async (t) => {
    const seen = await t.paymentEvents.get(event.eventId);
    if (seen) return { duplicate: true, outcome: seen.outcome };
    const at = new Date().toISOString();
    const outcome = event.kind === "DEPOSIT" ? await applyDepositEvent(t, event, at) : await applyWithdrawalEvent(t, event, at);
    await t.paymentEvents.put(event.eventId, outcome);
    return { duplicate: false, outcome };
  });
}

async function applyDepositEvent(t: Tx, event: NormalizedPaymentEvent, at: string): Promise<string> {
  const intent = await t.deposits.byRef(event.externalRef, { lock: true });
  if (!intent) return "UNMATCHED_FOR_REVIEW";
  const note = (status: string, n?: string) => intent.history.push({ status, at, eventId: event.eventId, note: n });
  const save = () => t.deposits.put(intent);
  const current = intent.status;
  const terminal = current === "FAILED" || current === "EXPIRED" || current === "REVIEW";

  if (event.status === "PENDING" || event.status === "CONFIRMED") {
    if (terminal) {
      note(current, `Ignored ${event.status} after ${current}; manual review`);
      await save();
      return "IGNORED_TERMINAL";
    }
    if (DEPOSIT_RANK[event.status] <= DEPOSIT_RANK[current]) {
      note(current, `Ignored late ${event.status}`);
      await save();
      return "IGNORED_OUT_OF_ORDER";
    }
    if (event.status === "PENDING") {
      intent.status = "PENDING";
      note("PENDING");
      await save();
      return "PENDING";
    }
    if (event.amountUnits !== intent.tokenUnits) {
      intent.status = "REVIEW";
      note("REVIEW", `Amount mismatch: expected ${intent.tokenUnits}, received ${event.amountUnits}`);
      await save();
      return "REVIEW";
    }
    note("CONFIRMED");
    await creditDeposit(t, intent.userId, intent.id, intent.tokenUnits);
    intent.status = "CREDITED";
    note("CREDITED");
    await save();
    return "CREDITED";
  }
  if (event.status === "FAILED" || event.status === "EXPIRED") {
    if (current === "CREDITED") {
      intent.status = "REVIEW";
      note("REVIEW", `${event.status} received after credit; reversal requires review`);
      await save();
      return "REVIEW";
    }
    if (terminal) return "IGNORED_TERMINAL";
    intent.status = event.status;
    note(event.status);
    await save();
    return event.status;
  }
  return "IGNORED_UNKNOWN_STATUS";
}

async function applyWithdrawalEvent(t: Tx, event: NormalizedPaymentEvent, at: string): Promise<string> {
  const w = await t.withdrawals.byRef(event.externalRef, { lock: true });
  if (!w) return "UNMATCHED_FOR_REVIEW";
  const status = event.status as WithdrawalStatus;
  if (WITHDRAWAL_TERMINAL.has(w.status)) {
    w.history.push({ status: w.status, at, eventId: event.eventId, note: `Ignored ${status} after ${w.status}` });
    await t.withdrawals.put(w);
    return "IGNORED_TERMINAL";
  }
  if (status === "REJECTED" || status === "FAILED") {
    await releaseWithdrawal(t, w.userId, w.id, w.amountUnits);
  } else if (status === "PAID") {
    await completeWithdrawal(t, w.userId, w.id, w.amountUnits);
  } else if (WITHDRAWAL_FLOW.indexOf(status) <= WITHDRAWAL_FLOW.indexOf(w.status)) {
    w.history.push({ status: w.status, at, eventId: event.eventId, note: `Ignored late ${status}` });
    await t.withdrawals.put(w);
    return "IGNORED_OUT_OF_ORDER";
  }
  w.status = status;
  w.history.push({ status, at, eventId: event.eventId });
  await t.withdrawals.put(w);
  return status;
}

export async function requestWithdrawal(userId: string, body: { amount?: unknown; destination?: unknown; actionId?: unknown }) {
  const tokens = Number(body.amount);
  if (!Number.isInteger(tokens) || tokens < 1) throw new ApiError(400, "INVALID_INPUT", "Amount must be a whole number of tokens");
  const destination = typeof body.destination === "string" ? body.destination.slice(0, 64) : "Simulated bank account";
  const withdrawalId = `wd_${randomUUID().slice(0, 8)}`;
  const { externalRef } = await paymentAdapter.requestWithdrawal({ withdrawalId, amountUnits: tokens * TOKEN_SCALE, destination });
  return tx((t) =>
    idempotent(t, `withdraw:${userId}`, body.actionId, [tokens, destination], async () => {
      const units = tokens * TOKEN_SCALE;
      try {
        // Only PAID_AVAILABLE can fund this; free credits and match reserves are separate accounts.
        await reserveWithdrawal(t, userId, withdrawalId, units);
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
      await t.withdrawals.put(w);
      return w;
    }),
  );
}

export function cancelWithdrawal(userId: string, withdrawalId: string) {
  return tx(async (t) => {
    const w = await t.withdrawals.get(withdrawalId, { lock: true });
    if (!w || w.userId !== userId) throw notFound("Withdrawal");
    if (w.status === "CANCELLED") return w;
    // Cancellable only while the provider is guaranteed not to have sent funds.
    if (w.status !== "REQUESTED" && w.status !== "PENDING_REVIEW") {
      throw new ApiError(409, "WRONG_PHASE", "This withdrawal can no longer be cancelled");
    }
    await releaseWithdrawal(t, userId, w.id, w.amountUnits);
    w.status = "CANCELLED";
    w.history.push({ status: "CANCELLED", at: new Date().toISOString() });
    await t.withdrawals.put(w);
    return w;
  });
}

export function findOwnedPaymentObject(userId: string, kind: "DEPOSIT" | "WITHDRAWAL", id: string) {
  return tx(async (t) => {
    const obj = kind === "DEPOSIT" ? await t.deposits.get(id) : await t.withdrawals.get(id);
    if (!obj || obj.userId !== userId) throw notFound(kind === "DEPOSIT" ? "Deposit" : "Withdrawal");
    return obj;
  });
}
