import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { leaderboard, ratingBoard } from "@/lib/server/leaderboard";

/** GET /api/leaderboard?period=week|season|rating — standings, your rank and the prize zone. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("period");
  if (p === "rating") return handle((user) => ratingBoard(user.id));
  return handle((user) => leaderboard(user.id, p === "season" ? "season" : "week"));
}
