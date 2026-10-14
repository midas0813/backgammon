import { adminHandle } from "@/lib/server/admin/http";
import { requestAdjustment } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/finance/adjustments — { userId, accountKind, amount (minor units), reason, nonce, signature } */
export async function POST(req: Request) {
  const body = await readJson(req);
  return adminHandle("finance.adjust", (ctx) => requestAdjustment(ctx, body));
}
