import { adminHandle } from "@/lib/server/admin/http";
import { updateSettings } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** POST /api/admin/settings — { patch, reason, nonce, signature } (Owner, signed). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return adminHandle("settings.manage", (ctx) => updateSettings(ctx, body));
}
