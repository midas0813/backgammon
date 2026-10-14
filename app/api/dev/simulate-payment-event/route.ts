import { randomUUID } from "node:crypto";
import { TOKEN_SCALE } from "@/lib/fees";
import { handle, readJson } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { signSimulatedEvent, simulatedPaymentsEnabled } from "@/lib/server/payments/simulated";
import { findOwnedPaymentObject, paymentAdapter, processPaymentEvent } from "@/lib/server/wallet";

/**
 * Development only: plays the role of the payment provider by emitting a signed event for one of the
 * caller's own intents and feeding it through the same verification path as a real callback.
 * Body: { kind: DEPOSIT | WITHDRAWAL, id, status, amountTokens?, replayEventId? }
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(async (user) => {
    if (!simulatedPaymentsEnabled()) throw new ApiError(404, "NOT_FOUND", "Not available");
    const kind = body.kind === "WITHDRAWAL" ? "WITHDRAWAL" : "DEPOSIT";
    const obj = await findOwnedPaymentObject(user.id, kind, String(body.id));
    const amountUnits =
      body.amountTokens !== undefined ? Math.round(Number(body.amountTokens) * TOKEN_SCALE) : "tokenUnits" in obj ? obj.tokenUnits : obj.amountUnits;
    const raw = JSON.stringify({
      eventId: typeof body.replayEventId === "string" ? body.replayEventId : `sim_evt_${randomUUID().slice(0, 8)}`,
      kind,
      externalRef: obj.externalRef,
      status: String(body.status),
      amountUnits,
      occurredAt: new Date().toISOString(),
    });
    const event = paymentAdapter.validateAndNormalizeEvent(raw, signSimulatedEvent(raw));
    return { eventId: event.eventId, ...(await processPaymentEvent(event)) };
  });
}
