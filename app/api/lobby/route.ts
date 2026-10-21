import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { lobby } from "@/lib/server/lobby";
import { isGameType } from "@/lib/games";

/** GET /api/lobby?v=<version> — your tables and matches plus lobby counts; {unchanged} when `v` is current. */
export async function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get("v");
  const game = req.nextUrl.searchParams.get("game");
  return handle(async (user) => {
    const data = await lobby(user.id, isGameType(game) ? game : "backgammon");
    return v && v === data.version ? { unchanged: true, version: data.version } : data;
  });
}
