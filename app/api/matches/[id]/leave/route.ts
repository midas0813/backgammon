import { handle } from "@/lib/server/http";
import { leaveMatch } from "@/lib/server/matches";

/**
 * POST /api/matches/:id/leave — free the player for another game: closes a waiting table, ends a
 * computer or pass & play game with no result, or forfeits an online match.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/matches/[id]/leave">) {
  const { id } = await ctx.params;
  return handle((user) => leaveMatch(user.id, id));
}
