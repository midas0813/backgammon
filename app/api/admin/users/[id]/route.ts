import { adminHandle } from "@/lib/server/admin/http";
import { userDetail } from "@/lib/server/admin/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await ctx.params;
  return adminHandle("users.view", (admin) => userDetail(admin, id));
}
