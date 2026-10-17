import { adminHandle } from "@/lib/server/admin/http";
import { setInviteCodeActive } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/beta/codes/:code — { active }: switch a code on or off. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/beta/codes/[code]">) {
  const { code } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("settings.manage", (admin) => setInviteCodeActive(admin, code, body.active === true));
}
