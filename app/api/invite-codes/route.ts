import type { NextRequest } from "next/server";
import { checkCode } from "@/lib/server/beta";
import { errorResponse } from "@/lib/server/http";

/** GET /api/invite-codes?code=ABC — whether an invite code is valid (and whether one is required). */
export async function GET(req: NextRequest) {
  try {
    return Response.json(await checkCode(req.nextUrl.searchParams.get("code")), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
