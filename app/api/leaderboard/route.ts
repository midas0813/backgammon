import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { leaderboard } from "@/lib/server/leaderboard";

/** GET /api/leaderboard?period=week|season — standings, your rank and the prize zone. */
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") === "season" ? "season" : "week";
  return handle((user) => leaderboard(user.id, period));
}
