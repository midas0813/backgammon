import { read } from "@/lib/server/db";

/** GET /api/stats — real, aggregate-only numbers for the landing page. */
export async function GET() {
  const stats = read((db) => {
    const matches = Object.values(db.matches);
    const games = matches.reduce((n, m) => n + m.state.results.length, 0);
    return {
      players: Object.keys(db.users).length,
      liveMatches: matches.filter((m) => m.state.status === "ACTIVE").length,
      gamesPlayed: games,
      waiting: matches.filter((m) => m.mode === "quick" && m.state.status === "WAITING").length,
    };
  });
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
