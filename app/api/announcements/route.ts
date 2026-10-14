import { activeAnnouncements } from "@/lib/server/admin/service";
import { errorResponse } from "@/lib/server/http";

/** GET /api/announcements — active operator announcements and maintenance notice (public). */
export async function GET() {
  try {
    return Response.json(await activeAnnouncements(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
