import { adminHandle } from "@/lib/server/admin/http";
import { decideFlag } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/flags/:id — { decision: "dismiss" | "void", reason, nonce?, signature? }. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/flags/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("matches.manage", (admin) => decideFlag(admin, Number(id), body));
}
