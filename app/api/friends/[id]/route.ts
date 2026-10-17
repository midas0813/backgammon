import { handle, readJson } from "@/lib/server/http";
import { respondFriend } from "@/lib/server/social";

/** POST /api/friends/:id — { accept: true } to accept a request, { accept: false } to decline or remove. */
export async function POST(req: Request, ctx: RouteContext<"/api/friends/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => respondFriend(user.id, Number(id), body.accept === true), { limit: "profile" });
}
