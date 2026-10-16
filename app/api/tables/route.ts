import type { NextRequest } from "next/server";
import { errorResponse, handle, readJson } from "@/lib/server/http";
import { createTable, publicTables } from "@/lib/server/lobby";

/**
 * GET /api/tables?view=open|live&points=3&fee=free&sort=newest&page=0 — one page of public tables.
 * The response is the same for every player, so the CDN serves it for a couple of seconds: thousands
 * of players browsing cost one database query per filter combination every ~2 s.
 */
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const data = await publicTables({ view: p.get("view"), points: p.get("points"), fee: p.get("fee"), sort: p.get("sort"), page: p.get("page") });
    return Response.json(data, { headers: { "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=4" } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/tables — { targetPoints, visibility: "public" | "private", allowSpectators }. Free only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => createTable(user.id, body), { limit: "game" });
}
