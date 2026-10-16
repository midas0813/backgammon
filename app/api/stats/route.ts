import { errorResponse } from "@/lib/server/http";
import { LIVE_WINDOW_MS } from "@/lib/server/lobby";
import { tx } from "@/lib/server/store";

/**
 * GET /api/stats — real, aggregate-only numbers for the landing page. The same for every visitor,
 * so the CDN serves it for 15 s: thousands of visitors cost one query.
 */
export async function GET() {
  try {
    const stats = await tx(async (t) => ({
      players: await t.users.countRegistered(),
      liveMatches: await t.matches.countActiveSince(Date.now() - LIVE_WINDOW_MS),
      gamesPlayed: (await t.counters.get(["games"])).games,
    }));
    return Response.json(stats, { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" } });
  } catch (e) {
    return errorResponse(e);
  }
}
