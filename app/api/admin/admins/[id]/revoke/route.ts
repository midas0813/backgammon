import { adminHandle } from "@/lib/server/admin/http";
import { revokeRole } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/admin/admins/[id]/revoke">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("admins.manage", (admin) => revokeRole(admin, id, body));
}
