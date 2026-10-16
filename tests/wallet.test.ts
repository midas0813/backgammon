import { describe, expect, it } from "vitest";
import { computeFee, feeRateBps, TOKEN_SCALE } from "@/lib/fees";
import {
  SYSTEM,
  creditDeposit,
  reconcile,
  releaseMatchReserve,
  reserveForMatch,
  settleFixedStake,
  settleTokensPerPoint,
  userAccount,
  userBalances,
} from "@/lib/server/ledger";
import { tx } from "@/lib/server/store";
import { FREE_CREDIT_GRANT, ensureUser, grantWelcomeCredits } from "@/lib/server/users";
import { createPurchaseIntent, getWallet, processPaymentEvent, requestWithdrawal } from "@/lib/server/wallet";

const T = TOKEN_SCALE;
const W = "00000000-0000-4000-8000-000000000001";
const L = "00000000-0000-4000-8000-000000000002";

describe("fees (proposed policy)", () => {
  it("uses full-tier rates at the boundaries", () => {
    expect(feeRateBps(10 * T)).toBe(1000);
    expect(feeRateBps(10 * T + 1)).toBe(500);
    expect(feeRateBps(49999)).toBe(500); // 499.99
    expect(feeRateBps(50000)).toBe(250); // 500.00
  });

  it("rounds half-up to the minor unit", () => {
    expect(computeFee(49999)).toBe(2500); // 5% of 499.99 = 24.9995 → 25.00
    expect(computeFee(50000)).toBe(1250);
  });

  it("base 5, cube 128 single: gross 640, fee 16, net 624", () => {
    const gross = 5 * 128 * 1 * T;
    expect(computeFee(gross)).toBe(16 * T);
    expect(gross - computeFee(gross)).toBe(624 * T);
  });
});

describe("ledger settlement", () => {
  it("tokens-per-point B=1: reserve 384 each; C=2 gammon loses 4; reserves released; balanced", async () => {
    const R = 384 * T;
    const G = 1 * 2 * 2 * T;
    await tx(async (t) => {
      await creditDeposit(t, W, "d1", 500 * T);
      await creditDeposit(t, L, "d2", 500 * T);
      await reserveForMatch(t, W, "m1", R);
      await reserveForMatch(t, L, "m1", R);
    });
    expect(await tx((t) => userBalances(t, W))).toMatchObject({ available: 116 * T, matchReserved: R });
    await tx((t) => settleTokensPerPoint(t, { matchKey: "m1", winner: W, loser: L, reserve: R, gross: G, fee: 0 }));
    // A duplicate settlement is a no-op.
    await tx((t) => settleTokensPerPoint(t, { matchKey: "m1", winner: W, loser: L, reserve: R, gross: G, fee: 0 }));
    expect(await tx((t) => userBalances(t, W))).toMatchObject({ available: 504 * T, matchReserved: 0 });
    expect(await tx((t) => userBalances(t, L))).toMatchObject({ available: 496 * T, matchReserved: 0 });
    expect(await tx(reconcile)).toEqual([]);
  });

  it("a match called off before it starts releases the reserve exactly once", async () => {
    await tx(async (t) => {
      await creditDeposit(t, W, "d1", 50 * T);
      await reserveForMatch(t, W, "m3", 20 * T);
    });
    await tx((t) => releaseMatchReserve(t, W, "m3", 20 * T));
    await tx((t) => releaseMatchReserve(t, W, "m3", 20 * T)); // retried: no double refund
    expect(await tx((t) => userBalances(t, W))).toMatchObject({ available: 50 * T, matchReserved: 0 });
    expect(await tx(reconcile)).toEqual([]);
  });

  it("fixed stake 100 each with fee 10: winner gross 190, loser −100, company +10", async () => {
    await tx(async (t) => {
      await creditDeposit(t, W, "d1", 100 * T);
      await creditDeposit(t, L, "d2", 100 * T);
      await reserveForMatch(t, W, "m2", 100 * T);
      await reserveForMatch(t, L, "m2", 100 * T);
      await settleFixedStake(t, { matchKey: "m2", winner: W, loser: L, stake: 100 * T, fee: 10 * T });
    });
    expect((await tx((t) => userBalances(t, W))).available).toBe(190 * T);
    expect((await tx((t) => userBalances(t, L))).available).toBe(0);
    expect((await tx((t) => t.ledger.balances([SYSTEM.companyRevenue], false)))[SYSTEM.companyRevenue]).toBe(10 * T);
    expect(await tx(reconcile)).toEqual([]);
  });

  it("refuses to reserve more than is available (no overdraft) and rolls back", async () => {
    await tx((t) => creditDeposit(t, W, "d1", 10 * T));
    await expect(tx((t) => reserveForMatch(t, W, "m3", 384 * T))).rejects.toThrow(/Insufficient/);
    expect((await tx((t) => userBalances(t, W))).available).toBe(10 * T);
  });
});

describe("simulated deposits and withdrawals", () => {
  function event(externalRef: string, status: string, amountUnits: number, eventId: string, kind = "DEPOSIT") {
    return { eventId, kind, externalRef, status, amountUnits, occurredAt: new Date().toISOString() } as Parameters<typeof processPaymentEvent>[0];
  }

  it("$25 credits 25 tokens once; pending is not spendable; duplicates and late events are ignored", async () => {
    const u = await ensureUser(undefined);
    const intent = await createPurchaseIntent(u.id, { quantity: 25, method: "CARD", actionId: "p1" });
    await processPaymentEvent(event(intent.externalRef, "PENDING", 25 * T, "e1"));
    expect((await getWallet(u.id)).balances).toMatchObject({ available: 0, pendingDeposits: 25 * T });
    await processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e2"));
    expect((await processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e2"))).duplicate).toBe(true);
    await processPaymentEvent(event(intent.externalRef, "CONFIRMED", 25 * T, "e3"));
    await processPaymentEvent(event(intent.externalRef, "PENDING", 25 * T, "e4"));
    const w = await getWallet(u.id);
    expect(w.balances.available).toBe(25 * T);
    expect(w.deposits[0].status).toBe("CREDITED");
  });

  it("an amount mismatch goes to review without credit", async () => {
    const u = await ensureUser(undefined);
    const intent = await createPurchaseIntent(u.id, { quantity: 25, method: "STABLECOIN", actionId: "p1" });
    await processPaymentEvent(event(intent.externalRef, "CONFIRMED", 20 * T, "e1"));
    const w = await getWallet(u.id);
    expect(w.balances.available).toBe(0);
    expect(w.deposits[0].status).toBe("REVIEW");
  });

  it("100 paid: lock 40 for a match, withdraw 20 → 40 / 40 / 20; free credits never fund paid actions", async () => {
    const u = await ensureUser(undefined);
    await tx(async (t) => {
      await grantWelcomeCredits(t, u.id);
      await creditDeposit(t, u.id, "seed", 100 * T);
      await reserveForMatch(t, u.id, "m1", 40 * T);
    });
    const wd = await requestWithdrawal(u.id, { amount: 20, actionId: "w1" });
    await requestWithdrawal(u.id, { amount: 20, actionId: "w1" }); // retried submission
    expect((await getWallet(u.id)).balances).toMatchObject({
      available: 40 * T,
      matchReserved: 40 * T,
      withdrawalReserved: 20 * T,
      freeCredits: FREE_CREDIT_GRANT,
    });
    await expect(requestWithdrawal(u.id, { amount: 41, actionId: "w2" })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // Rejection releases exactly once, even if the event is duplicated.
    await processPaymentEvent(event(wd.externalRef, "REJECTED", 20 * T, "x1", "WITHDRAWAL"));
    await processPaymentEvent(event(wd.externalRef, "REJECTED", 20 * T, "x2", "WITHDRAWAL"));
    expect((await getWallet(u.id)).balances).toMatchObject({ available: 60 * T, withdrawalReserved: 0 });
    expect(await tx(reconcile)).toEqual([]);
    const reserved = await tx((t) => t.ledger.balances([userAccount(u.id, "PAID_MATCH_RESERVED")], false));
    expect(reserved[userAccount(u.id, "PAID_MATCH_RESERVED")]).toBe(40 * T);
  });
});
