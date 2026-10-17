import { handle } from "@/lib/server/http";
import { addFriendFromMatch } from "@/lib/server/social";

/** POST /api/matches/:id/friend — send your opponent a friend request (or accept theirs). */
export async function POST(_req: Request, ctx: RouteContext<"/api/matches/[id]/friend">) {
  const { id } = await ctx.params;
  return handle((user) => addFriendFromMatch(user.id, id), { limit: "profile" });
}
