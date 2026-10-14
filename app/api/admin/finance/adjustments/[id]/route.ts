import { adminHandle } from "@/lib/server/admin/http";
import { decideAdjustment } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/finance/adjustments/:id — { approve: boolean, nonce, signature } by a different admin. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/finance/adjustments/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("finance.adjust", (admin) => decideAdjustment(admin, id, body));
}
