import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { lobby } from "@/lib/server/lobby";

/** GET /api/lobby?points=3&v=<version> — open tables, live matches, your tables; {unchanged} when `v` is current. */
export async function GET(req: NextRequest) {
  const points = Number(req.nextUrl.searchParams.get("points")) || undefined;
  const v = req.nextUrl.searchParams.get("v");
  return handle(async (user) => {
    const data = await lobby(user.id, { points });
    return v && v === data.version ? { unchanged: true, version: data.version } : data;
  });
}
