import { handle, readJson } from "@/lib/server/http";
import { rematch } from "@/lib/server/social";

/** POST /api/matches/:id/rematch — { clientSeed? }: play the same opponent again. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/rematch">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => rematch(user.id, id, body.clientSeed), { limit: "game" });
}
