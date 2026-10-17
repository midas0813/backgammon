import { adminHandle } from "@/lib/server/admin/http";
import { decidePrizeWeek } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/prizes/:week — { approve, note?, nonce, signature }: pay or skip a week's prizes. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/prizes/[week]">) {
  const { week } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("finance.adjust", (admin) => decidePrizeWeek(admin, week, body));
}
