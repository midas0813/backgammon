import { adminHandle } from "@/lib/server/admin/http";
import { setFeedbackStatus } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/beta/feedback/:id — { status: NEW | READ | DONE }. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/beta/feedback/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("disputes.manage", (admin) => setFeedbackStatus(admin, Number(id), body.status));
}
