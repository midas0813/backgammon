import { handle, readJson } from "@/lib/server/http";
import { getTournament, register, unregister } from "@/lib/server/tournaments";

/** GET /api/tournaments/:id — the bracket. */
export async function GET(_req: Request, ctx: RouteContext<"/api/tournaments/[id]">) {
  const { id } = await ctx.params;
  return handle((user) => getTournament(user.id, id));
}

/** POST /api/tournaments/:id — { action: "register" | "unregister" }. */
export async function POST(req: Request, ctx: RouteContext<"/api/tournaments/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => (body.action === "unregister" ? unregister(user.id, id) : register(user.id, id)), { limit: "game" });
}
