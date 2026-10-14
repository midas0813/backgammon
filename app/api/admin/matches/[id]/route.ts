import { adminHandle } from "@/lib/server/admin/http";
import { matchDetail } from "@/lib/server/admin/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/matches/[id]">) {
  const { id } = await ctx.params;
  return adminHandle("matches.view", (admin) => matchDetail(admin, id));
}
