import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { tableStatus } from "@/lib/server/lobby";

/** GET /api/tables/status?ids=a,b — whether the caller's own tables have been joined. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((id) => /^[0-9a-z]{6,20}$/.test(id));
  return handle((user) => tableStatus(user.id, ids));
}
