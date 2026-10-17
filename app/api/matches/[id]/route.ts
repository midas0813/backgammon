import type { NextRequest } from "next/server";
import { chatSince } from "@/lib/server/chat";
import { handle } from "@/lib/server/http";
import { getSnapshot, tickBot } from "@/lib/server/matches";

/**
 * GET /api/matches/:id — snapshot, version and event cursor. `?since=<version>` returns {unchanged}
 * when current; `?chat=<id>` adds newer chat messages (`chatFeed`).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/matches/[id]">) {
  const { id } = await ctx.params;
  const p = req.nextUrl.searchParams;
  const since = Number(p.get("since"));
  // `chat=<id>`: also return chat messages after that id (one request for board and chat).
  const chatAfter = p.has("chat") ? Number(p.get("chat")) : null;
  return handle(async (user) => {
    await tickBot(id);
    const snap = await getSnapshot(user.id, id);
    const online = snap.mode === "quick" || snap.mode === "private";
    const chatFeed = chatAfter !== null && online && snap.status !== "WAITING" ? await chatSince(user.id, id, chatAfter) : undefined;
    if (since && since === snap.stateVersion) {
      // Clocks and presence change without a new version, so they always come along.
      return {
        unchanged: true,
        stateVersion: snap.stateVersion,
        seats: snap.seats,
        serverNow: snap.serverNow,
        clock: snap.clock,
        hostReturnBy: snap.hostReturnBy,
        chatFeed,
      };
    }
    return { ...snap, chatFeed };
  });
}
