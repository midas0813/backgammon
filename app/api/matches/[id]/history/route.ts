import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { matchHistory } from "@/lib/server/matches";

/** GET /api/matches/:id/history?cursor=<seq> — committed events after the cursor. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/matches/[id]/history">) {
  const { id } = await ctx.params;
  const cursor = Math.max(0, Number(req.nextUrl.searchParams.get("cursor") ?? 0) || 0);
  return handle((user) => matchHistory(user.id, id, cursor));
}
