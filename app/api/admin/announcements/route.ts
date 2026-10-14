import { adminHandle } from "@/lib/server/admin/http";
import { createAnnouncement, listAnnouncementsAdmin } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

export async function GET() {
  return adminHandle("dashboard.view", (ctx) => listAnnouncementsAdmin(ctx));
}

/** POST /api/admin/announcements — { message, tone, hours? } */
export async function POST(req: Request) {
  const body = await readJson(req);
  return adminHandle("settings.manage", (ctx) => createAnnouncement(ctx, body));
}
