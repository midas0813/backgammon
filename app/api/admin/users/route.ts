import type { NextRequest } from "next/server";
import { adminHandle } from "@/lib/server/admin/http";
import { searchUsers } from "@/lib/server/admin/service";

export async function GET(req: NextRequest) {
  return adminHandle("users.view", (ctx) => searchUsers(ctx, req.nextUrl.searchParams.get("q") ?? ""));
}
