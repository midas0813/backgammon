import { adminHandle } from "@/lib/server/admin/http";
import { listPrizeWeeks } from "@/lib/server/admin/service";

/** GET /api/admin/prizes — recent weeks with their proposed or paid winners. */
export async function GET() {
  return adminHandle("finance.view", (admin) => listPrizeWeeks(admin));
}
