import { handle } from "@/lib/server/http";
import { cancelMatch } from "@/lib/server/matches";

export async function POST(_req: Request, ctx: RouteContext<"/api/matches/[id]/cancel">) {
  const { id } = await ctx.params;
  return handle((user) => cancelMatch(user.id, id), { limit: "game" });
}
