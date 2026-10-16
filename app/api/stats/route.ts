import { errorResponse } from "@/lib/server/http";
import { LIVE_WINDOW_MS, ONLINE_WINDOW_MS } from "@/lib/server/lobby";
import { tx } from "@/lib/server/store";

/**
 * GET /api/stats — real, aggregate-only numbers for the landing page. The same for every visitor,
 * so the CDN serves it for 15 s: thousands of visitors cost one query.
 */
export async function GET() {
  try {
    const stats = await tx(async (t) => ({
      // Players with the app open right now (not accounts ever created).
      online: await t.users.countSeenSince(Date.now() - ONLINE_WINDOW_MS),
      liveMatches: await t.matches.countActiveSince(Date.now() - LIVE_WINDOW_MS),
      gamesPlayed: (await t.counters.get(["games"])).games,
    }));
    return Response.json(stats, { headers: { "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=20" } });
  } catch (e) {
    return errorResponse(e);
  }
}
