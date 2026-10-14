import { adminHandle } from "@/lib/server/admin/http";
import { dashboard } from "@/lib/server/admin/service";

export async function GET() {
  return adminHandle("dashboard.view", (ctx) => dashboard(ctx));
}
