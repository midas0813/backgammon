import { adminHandle } from "@/lib/server/admin/http";
import { forceLogout, resetProfile, suspendUser, unsuspendUser } from "@/lib/server/admin/service";
import { ApiError } from "@/lib/server/errors";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/users/:id/(suspend|unsuspend|logout|reset) */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/users/[id]/[action]">) {
  const { id, action } = await ctx.params;
  const body = await readJson(req);
  return adminHandle("users.moderate", (admin) => {
    if (action === "suspend") return suspendUser(admin, id, body);
    if (action === "unsuspend") return unsuspendUser(admin, id, body);
    if (action === "logout") return forceLogout(admin, id, body);
    if (action === "reset") return resetProfile(admin, id, body);
    return Promise.reject(new ApiError(404, "NOT_FOUND", "Unknown action"));
  });
}
