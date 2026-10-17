import { adminHandle } from "@/lib/server/admin/http";
import { listBeta } from "@/lib/server/admin/service";

/** GET /api/admin/beta — invite codes with sign-ups, and feedback. */
export async function GET() {
  return adminHandle("disputes.view", (admin) => listBeta(admin));
}
