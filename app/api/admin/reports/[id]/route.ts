import { adminHandle } from "@/lib/server/admin/http";
import { reportDetail, updateReport } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/reports/[id]">) {
  const { id } = await ctx.params;
  return adminHandle("disputes.view", (admin) => reportDetail(admin, id));
}

/** POST /api/admin/reports/:id — { status?, assignToMe?, resolution?, note? } */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/reports/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("disputes.manage", (admin) => updateReport(admin, id, body));
}
