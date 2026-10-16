import { adminSignIn } from "@/lib/server/admin/auth";
import { requestMeta, setAdminCookie } from "@/lib/server/admin/http";
import { currentUser, errorResponse, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

/** POST /api/admin/signin — { nonce, signature } over the ADMIN_SIGN_IN challenge. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const user = await currentUser();
    await rateLimit("admin", user.id);
    const result = await adminSignIn(user, body, await requestMeta());
    await setAdminCookie(result.token);
    return Response.json({ role: result.role, expiresAt: result.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}
