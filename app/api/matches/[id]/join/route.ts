import { handle } from "@/lib/server/http";
import { joinMatch } from "@/lib/server/matches";

export async function POST(_req: Request, ctx: RouteContext<"/api/matches/[id]/join">) {
  const { id } = await ctx.params;
  return handle((user) => joinMatch(user.id, id));
}
