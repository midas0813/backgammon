import { adminSignOut } from "@/lib/server/admin/auth";
import { adminHandle, clearAdminCookie } from "@/lib/server/admin/http";

export async function POST() {
  return adminHandle(null, async (ctx) => {
    await adminSignOut(ctx);
    await clearAdminCookie();
    return { ok: true };
  });
}
