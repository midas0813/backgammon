import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { getSnapshot, tickBot } from "@/lib/server/matches";

/** GET /api/matches/:id — snapshot, version and event cursor. `?since=<version>` returns {unchanged} when current. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/matches/[id]">) {
  const { id } = await ctx.params;
  const since = Number(req.nextUrl.searchParams.get("since"));
  return handle((user) => {
    tickBot(id);
    const snap = getSnapshot(user.id, id);
    if (since && since === snap.stateVersion) {
      return { unchanged: true, stateVersion: snap.stateVersion, seats: snap.seats, serverNow: snap.serverNow };
    }
    return snap;
  });
}
