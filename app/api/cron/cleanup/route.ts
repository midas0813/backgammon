import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/server/http";
import { sweep } from "@/lib/server/matches";

/**
 * GET /api/cron/cleanup — daily housekeeping run by Vercel Cron (vercel.json): settles left games,
 * closes stale tables, removes idle guests and old rate-limit windows. The busy endpoints do the same
 * every few minutes; this catches anything left when nobody is using the site.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Not allowed" } }, { status: 401 });
  }
  try {
    let settled = 0;
    // Several passes: each handles up to 100 matches.
    for (let i = 0; i < 10; i++) {
      const n = await sweep(Date.now(), true);
      settled += n;
      if (n < 100) break;
    }
    return Response.json({ ok: true, settled });
  } catch (e) {
    return errorResponse(e);
  }
}
