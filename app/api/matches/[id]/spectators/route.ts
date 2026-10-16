import { handle, readJson } from "@/lib/server/http";
import { setSpectatorSettings } from "@/lib/server/matches";

/** POST /api/matches/:id/spectators — { allow?, chat?, emoji? }: the host's spectator settings. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/spectators">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => setSpectatorSettings(user.id, id, body), { limit: "game" });
}
