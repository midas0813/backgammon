import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedPaymentEvent, PaymentAdapter } from "./adapter";

/**
 * SIMULATED adapter for development. It never moves real money. Events are HMAC-signed with a
 * development secret so the processing path is the same one a real signed callback would take.
 */
const SECRET = process.env.SIMULATED_PAYMENTS_SECRET ?? "dev-only-simulated-secret";

export function simulatedPaymentsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_SIMULATED_PAYMENTS === "true";
}

export function signSimulatedEvent(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

export const simulatedAdapter: PaymentAdapter = {
  id: "simulated",
  async createDepositIntent(req) {
    return {
      externalRef: `sim_dep_${req.intentId}`,
      instructions:
        req.method === "STABLECOIN"
          ? `Simulated ${req.asset ?? "USDC"} on ${req.network ?? "sim-chain"}. No real transfer occurs.`
          : "Simulated card checkout. No card data is collected.",
    };
  },
  async getDepositStatus() {
    return "UNKNOWN";
  },
  validateAndNormalizeEvent(rawBody, signature) {
    if (!simulatedPaymentsEnabled()) throw new Error("Simulated payments are disabled");
    const expected = Buffer.from(signSimulatedEvent(rawBody), "hex");
    const given = Buffer.from(signature ?? "", "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("Invalid signature");
    const e = JSON.parse(rawBody) as NormalizedPaymentEvent;
    if (!e.eventId || !e.externalRef || !Number.isInteger(e.amountUnits)) throw new Error("Malformed event");
    return e;
  },
  async requestWithdrawal(req) {
    return { externalRef: `sim_wd_${req.withdrawalId}` };
  },
  async getWithdrawalStatus() {
    return "UNKNOWN";
  },
};
