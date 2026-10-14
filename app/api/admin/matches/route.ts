import type { NextRequest } from "next/server";
import { adminHandle } from "@/lib/server/admin/http";
import { listMatchesAdmin } from "@/lib/server/admin/service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return adminHandle("matches.view", (ctx) => listMatchesAdmin(ctx, { status: p.get("status") ?? undefined, userId: p.get("userId") ?? undefined }));
}
