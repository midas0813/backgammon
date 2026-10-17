import { adminHandle } from "@/lib/server/admin/http";
import { createInviteCode } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/beta/codes — { label, code?, maxUses?, days? }: a new invite code. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return adminHandle("settings.manage", (admin) => createInviteCode(admin, body));
}
