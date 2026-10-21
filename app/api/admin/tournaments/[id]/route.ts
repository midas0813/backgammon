import { adminHandle } from "@/lib/server/admin/http";
import { tournamentAction } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/tournaments/:id — { action: "cancel", reason } or { action: "start" }. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/tournaments/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("tournaments.manage", (admin) => tournamentAction(admin, id, body));
}
