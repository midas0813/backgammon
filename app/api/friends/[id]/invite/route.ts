import { handle, readJson } from "@/lib/server/http";
import { inviteFriend } from "@/lib/server/social";

/** POST /api/friends/:id/invite — { targetPoints, clock, clientSeed }: open a table and invite this friend. */
export async function POST(req: Request, ctx: RouteContext<"/api/friends/[id]/invite">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => inviteFriend(user.id, Number(id), body), { limit: "game" });
}
