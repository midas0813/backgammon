import { handle } from "@/lib/server/http";
import { cancelMatch } from "@/lib/server/matches";

/** DELETE /api/queues/:ticket — leave the queue before a match starts. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/queues/[ticket]">) {
  const { ticket } = await ctx.params;
  return handle((user) => cancelMatch(user.id, ticket));
}
