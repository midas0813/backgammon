import type { NextRequest } from "next/server";
import { adminHandle } from "@/lib/server/admin/http";
import { listReports } from "@/lib/server/admin/service";

export async function GET(req: NextRequest) {
  return adminHandle("disputes.view", (ctx) => listReports(ctx, req.nextUrl.searchParams.get("status") ?? undefined));
}
