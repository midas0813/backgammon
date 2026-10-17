import type { NextRequest } from "next/server";
import { adminHandle } from "@/lib/server/admin/http";
import { listFlags } from "@/lib/server/admin/service";

/** GET /api/admin/flags?status=OPEN — anti-cheat flags for review. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return adminHandle("matches.view", (admin) => listFlags(admin, status));
}
