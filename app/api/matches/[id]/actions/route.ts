import { handle, readJson } from "@/lib/server/http";
import { submitAction } from "@/lib/server/matches";

/** POST /api/matches/:id/actions — { actionId, expectedVersion, actionType, payload }. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/actions">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => submitAction(user.id, id, body));
}
