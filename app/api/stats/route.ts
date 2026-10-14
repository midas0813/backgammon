import { tx } from "@/lib/server/store";

/** GET /api/stats — real, aggregate-only numbers for the landing page. */
export async function GET() {
  const stats = await tx(async (t) => {
    const m = await t.matches.stats();
    return { players: await t.users.count(), liveMatches: m.live, gamesPlayed: m.games, waiting: m.waiting };
  });
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
