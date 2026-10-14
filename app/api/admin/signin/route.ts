import { adminSignIn } from "@/lib/server/admin/auth";
import { requestMeta, setAdminCookie } from "@/lib/server/admin/http";
import { currentUser, errorResponse, readJson } from "@/lib/server/http";

/** POST /api/admin/signin — { nonce, signature } over the ADMIN_SIGN_IN challenge. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const result = await adminSignIn(await currentUser(), body, await requestMeta());
    await setAdminCookie(result.token);
    return Response.json({ role: result.role, expiresAt: result.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}
