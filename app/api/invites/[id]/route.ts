import { handle, readJson } from "@/lib/server/http";
import { respondInvite } from "@/lib/server/social";

/** POST /api/invites/:id — { accept, clientSeed? }: join the inviting friend's table, or decline. */
export async function POST(req: Request, ctx: RouteContext<"/api/invites/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => respondInvite(user.id, Number(id), body.accept === true, body.clientSeed), { limit: "game" });
}
