import { randomBytes } from "node:crypto";
import { ApiError } from "./errors";
import { tx, type Dispute } from "./store";

const CATEGORIES: Dispute["category"][] = ["GAME", "PAYMENT", "ACCOUNT", "OTHER"];

/** POST /disputes (spec 03): a player reports a problem; returns a reference ID and status. */
export async function createDispute(
  userId: string,
  body: { category?: unknown; reason?: unknown; matchId?: unknown; transactionId?: unknown },
) {
  const category = CATEGORIES.includes(body.category as Dispute["category"]) ? (body.category as Dispute["category"]) : "OTHER";
  const reason = typeof body.reason === "string" ? body.reason.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim() : "";
  if (reason.length < 5 || reason.length > 2000) throw new ApiError(400, "INVALID_INPUT", "Please describe the problem (5–2000 characters)");
  const matchId = typeof body.matchId === "string" && /^[0-9a-z]{6,20}$/.test(body.matchId) ? body.matchId : undefined;
  const transactionId = typeof body.transactionId === "string" && body.transactionId.length <= 64 ? body.transactionId : undefined;

  return tx(async (t) => {
    if (matchId) {
      const m = await t.matches.get(matchId);
      if (!m || !m.seats.includes(userId)) throw new ApiError(403, "NOT_PARTICIPANT", "You can only report matches you played");
    }
    const recent = (await t.disputes.listByUser(userId)).filter((d) => Date.now() - Date.parse(d.createdAt) < 60 * 60 * 1000);
    if (recent.length >= 5) throw new ApiError(429, "RATE_LIMITED", "You have sent several reports recently. Please wait before sending another.");
    const d: Dispute = {
      id: `RPT-${randomBytes(4).toString("hex").toUpperCase()}`,
      userId,
      matchId,
      transactionId,
      category,
      reason,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    await t.disputes.put(d);
    return { referenceId: d.id, status: d.status, createdAt: d.createdAt };
  });
}

export function listDisputes(userId: string) {
  return tx(async (t) =>
    (await t.disputes.listByUser(userId)).map((d) => ({
      referenceId: d.id,
      category: d.category,
      status: d.status,
      matchId: d.matchId ?? null,
      createdAt: d.createdAt,
    })),
  );
}
