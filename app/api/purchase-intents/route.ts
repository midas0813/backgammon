import { handle, readJson } from "@/lib/server/http";
import { createPurchaseIntent } from "@/lib/server/wallet";

/** POST /api/purchase-intents — { quantity, method: CARD | STABLECOIN, actionId }. Simulated provider only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => createPurchaseIntent(user.id, body));
}
