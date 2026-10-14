import type { NextRequest } from "next/server";
import { homeData } from "@/lib/server/home";
import { handle } from "@/lib/server/http";

/** GET /api/home?tz=<Date#getTimezoneOffset()> — account status, today's progress and what to continue. */
export async function GET(req: NextRequest) {
  const tz = Number(req.nextUrl.searchParams.get("tz") ?? 0);
  return handle((user) => homeData(user.id, tz));
}
