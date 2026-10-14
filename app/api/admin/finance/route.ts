import { adminHandle } from "@/lib/server/admin/http";
import { financeOverview } from "@/lib/server/admin/service";

export async function GET() {
  return adminHandle("finance.view", (ctx) => financeOverview(ctx));
}
