import { adminHandle } from "@/lib/server/admin/http";
import { cancelTableAdmin, removeChatMessage, voidMatch } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/matches/:id/(cancel|void|chat-remove) */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/matches/[id]/[action]">) {
  const { id, action } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("matches.manage", (admin) =>
    action === "void" ? voidMatch(admin, id, body) : action === "chat-remove" ? removeChatMessage(admin, id, body) : cancelTableAdmin(admin, id, body),
  );
}
