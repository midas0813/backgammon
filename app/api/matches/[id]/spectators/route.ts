import { handle, readJson } from "@/lib/server/http";
import { setAllowSpectators } from "@/lib/server/matches";

/** POST /api/matches/:id/spectators — { allow: boolean }. Players only. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/spectators">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => setAllowSpectators(user.id, id, body.allow !== false), { limit: "game" });
}
