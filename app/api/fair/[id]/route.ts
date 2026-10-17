import { errorResponse } from "@/lib/server/http";
import { fairRecord } from "@/lib/server/fairCheck";

/** GET /api/fair/:id — a match's dice fingerprint, seeds and rolls (the secret once it is over). Public. */
export async function GET(_req: Request, ctx: RouteContext<"/api/fair/[id]">) {
  const { id } = await ctx.params;
  try {
    const r = await fairRecord(id.slice(0, 20));
    return Response.json(r, { headers: { "Cache-Control": r.fair.serverSeed ? "public, max-age=60" : "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
