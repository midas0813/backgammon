import { handle, readJson } from "@/lib/server/http";
import { joinMatch } from "@/lib/server/matches";

/** POST /api/matches/:id/join — { clientSeed? }: take the empty seat; the seed adds to the fair dice. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/join">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => joinMatch(user.id, id, body.clientSeed), { limit: "game" });
}
