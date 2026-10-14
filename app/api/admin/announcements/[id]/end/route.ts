import { adminHandle } from "@/lib/server/admin/http";
import { endAnnouncement } from "@/lib/server/admin/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/admin/announcements/[id]/end">) {
  const { id } = await ctx.params;
  return adminHandle("settings.manage", (admin) => endAnnouncement(admin, id));
}
