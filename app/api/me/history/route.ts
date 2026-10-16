import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { tx } from "@/lib/server/store";
import { matchHistoryPage } from "@/lib/server/users";

/** GET /api/me/history?offset=10 — the next page of the player's finished matches. */
export async function GET(req: NextRequest) {
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  return handle((user) => tx((t) => matchHistoryPage(t, user.id, offset)));
}
