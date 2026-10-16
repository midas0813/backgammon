import { handle, readJson } from "@/lib/server/http";
import { requestWithdrawal } from "@/lib/server/wallet";

/** POST /api/withdrawal-intents — { amount, destination, actionId }. Reserves paid tokens atomically. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => requestWithdrawal(user.id, body), { limit: "payments" });
}
