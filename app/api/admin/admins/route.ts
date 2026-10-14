import { adminHandle } from "@/lib/server/admin/http";
import { grantRole, listAdmins } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

export async function GET() {
  return adminHandle("admins.manage", (ctx) => listAdmins(ctx));
}

/** POST /api/admin/admins — { wallet, role, reason, nonce, signature } (Owner, signed). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return adminHandle("admins.manage", (ctx) => grantRole(ctx, body));
}
