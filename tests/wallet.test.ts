import { beforeEach, describe, expect, it } from "vitest";
import { computeFee, feeRateBps, TOKEN_SCALE } from "@/lib/fees";
import { read, resetDb, transact } from "@/lib/server/db";
import {
  balance,
  creditDeposit,
  emptyLedger,
  reconcile,
  reserveForMatch,
  settleFixedStake,
  settleTokensPerPoint,
  SYSTEM,
  userAccount,
  userBalances,
} from "@/lib/server/ledger";
import { ensureUser, FREE_CREDIT_GRANT } from "@/lib/server/users";
import { createPurchaseIntent, getWallet, processPaymentEvent, requestWithdrawal } from "@/lib/server/wallet";

const T = TOKEN_SCALE;

describe("fees (proposed policy)", () => {
  it("uses full-tier rates at the boundaries", () => {
    expect(feeRateBps(10 * T)).toBe(1000);
    expect(feeRateBps(10 * T + 1)).toBe(500);
    expect(feeRateBps(49999)).toBe(500); // 499.99
    expect(feeRateBps(50000)).toBe(250); // 500.00
  });

  it("rounds half-up to the minor unit", () => {
    expect(computeFee(49999)).toBe(2500); // 5% of 499.99 = 24.9995 → 25.00
    expect(computeFee(50000)).toBe(1250); // 2.5% of 500 = 12.50
  });

  it("base 5, cube 128 single: gross 640, fee 16, net 624", () => {
    const gross = 5 * 128 * 1 * T;
    expect(gross).toBe(640 * T);
    expect(computeFee(gross)).toBe(16 * T);
    expect(gross - computeFee(gross)).toBe(624 * T);
  });
});

describe("ledger settlement", () => {
  it("tokens-per-point B=1: reserve 384 each; C=2 gammon loses 4; reserves released; balanced", () => {
    const l = emptyLedger();
    creditDeposit(l, "w", "d1", 500 * T);
    creditDeposit(l, "l", "d2", 500 * T);
    const R = 384 * 1 * T;
    reserveForMatch(l, "w", "m1", R);
    reserveForMatch(l, "l", "m1", R);
    expect(userBalances(l, "w")).toMatchObject({ available: 116 * T, matchReserved: R });
    const G = 1 * 2 * 2 * T;
    settleTokensPerPoint(l, { matchKey: "m1", winner: "w", loser: "l", reserve: R, gross: G, fee: 0 });
    expect(userBalances(l, "w")).toMatchObject({ available: 504 * T, matchReserved: 0 });
    expect(userBalances(l, "l")).toMatchObject({ available: 496 * T, matchReserved: 0 });
    // A duplicate settlement is a no-op.
    settleTokensPerPoint(l, { matchKey: "m1", winner: "w", loser: "l", reserve: R, gross: G, fee: 0 });
    expect(userBalances(l, "w").available).toBe(504 * T);
    expect(reconcile(l)).toEqual([]);
  });

  it("fixed stake 100 each with fee 10: winner gross 190, loser −100, company +10", () => {
    const l = emptyLedger();
    creditDeposit(l, "w", "d1", 100 * T);
    creditDeposit(l, "l", "d2", 100 * T);
    reserveForMatch(l, "w", "m2", 100 * T);
    reserveForMatch(l, "l", "m2", 100 * T);
    settleFixedStake(l, { matchKey: "m2", winner: "w", loser: "l", stake: 100 * T, fee: 10 * T });
    expect(userBalances(l, "w").available).toBe(190 * T);
    expect(userBalances(l, "l").available).toBe(0);
    expect(balance(l, SYSTEM.companyRevenue)).toBe(10 * T);
    expect(reconcile(l)).toEqual([]);
  });

  it("refuses to reserve more than is available (no overdraft)", () => {
    const l = emptyLedger();
    creditDeposit(l, "p", "d1", 10 * T);
    expect(() => reserveForMatch(l, "p", "m3", 384 * T)).toThrow(/Insufficient/);
    expect(userBalances(l, "p").available).toBe(10 * T);
  });
});

describe("simulated deposits and withdrawals", () => {
  beforeEach(() => resetDb());

  function event(externalRef: string, status: string, amountUnits: number, eventId: string, kind = "DEPOSIT") {
    return { eventId, kind, externalRef, status, amountUnits, occurredAt: new Date().toISOString() } as Parameters<
      typeof processPaymentEvent
    >[0];
  }

  it("$25 credits 25 tokens once; pending is not spendable; duplicates and late events are ignored", async () => {
    const u = ensureUser(undefined);
    const intent = await createPurchaseIntent(u.id, { quantity: 25, method: "CARD", actionId: "p1" });
    processPaymentEvent(event(intent.externalRef, "PENDING", 25 * T, "e1"));
    expect(getWallet(u.id).balances).toMatchObject({ available: 0, pendingDeposits: 25 * T });
    processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e2"));
    expect(processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e2")).duplicate).toBe(true);
    processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e3")); // different id, same confirmation
    processPaymentEvent(event(intent.externalRef, "PENDING", 25 * T, "e4")); // late, out of order
    const w = getWallet(u.id);
    expect(w.balances.available).toBe(25 * T);
    expect(w.deposits[0].status).toBe("CREDITED");
  });

  it("an amount mismatch goes to review without credit", async () => {
    const u = ensureUser(undefined);
    const intent = await createPurchaseIntent(u.id, { quantity: 25, method: "STABLECOIN", actionId: "p1" });
    processPaymentEvent(event(intent.externalRef, "CONFIRMED", 20 * T, "e1"));
    expect(getWallet(u.id).balances.available).toBe(0);
    expect(getWallet(u.id).deposits[0].status).toBe("REVIEW");
  });

  it("100 paid: lock 40 for a match, withdraw 20 → 40 / 40 / 20; free credits never fund paid actions", async () => {
    const u = ensureUser(undefined);
    transact((db) => {
      creditDeposit(db.ledger, u.id, "seed", 100 * T);
      reserveForMatch(db.ledger, u.id, "m1", 40 * T);
    });
    const wd = await requestWithdrawal(u.id, { amount: 20, actionId: "w1" });
    await requestWithdrawal(u.id, { amount: 20, actionId: "w1" }); // retried submission
    expect(getWallet(u.id).balances).toMatchObject({
      available: 40 * T,
      matchReserved: 40 * T,
      withdrawalReserved: 20 * T,
      freeCredits: FREE_CREDIT_GRANT,
    });
    await expect(requestWithdrawal(u.id, { amount: 41, actionId: "w2" })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // Rejection releases exactly once, even if the event is duplicated.
    processPaymentEvent(event(wd.externalRef, "REJECTED", 20 * T, "x1", "WITHDRAWAL"));
    processPaymentEvent(event(wd.externalRef, "REJECTED", 20 * T, "x2", "WITHDRAWAL"));
    expect(getWallet(u.id).balances).toMatchObject({ available: 60 * T, withdrawalReserved: 0 });
    expect(read((db) => reconcile(db.ledger))).toEqual([]);
    expect(read((db) => balance(db.ledger, userAccount(u.id, "PAID_MATCH_RESERVED")))).toBe(40 * T);
  });
});
