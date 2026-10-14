import type { NextRequest } from "next/server";
import { adminHandle } from "@/lib/server/admin/http";
import { listAuditAdmin } from "@/lib/server/admin/service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return adminHandle(null, (ctx) =>
    listAuditAdmin(ctx, { actorId: p.get("actorId") ?? undefined, targetType: p.get("targetType") ?? undefined, targetId: p.get("targetId") ?? undefined }),
  );
}
