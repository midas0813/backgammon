import { currentAdmin } from "@/lib/server/admin/http";
import { PERMISSIONS } from "@/lib/server/admin/auth";
import { errorResponse, currentUser } from "@/lib/server/http";

/** GET /api/admin/session — whether this wallet has an unlocked admin session (null otherwise). */
export async function GET() {
  try {
    const user = await currentUser();
    const admin = await currentAdmin(null).catch(() => null);
    return Response.json(
      {
        wallet: user.walletAddress ?? null,
        admin: admin
          ? {
              name: admin.name,
              wallet: admin.wallet,
              role: admin.role,
              permissions: PERMISSIONS[admin.role],
              since: new Date(admin.sessionCreatedAt).toISOString(),
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
