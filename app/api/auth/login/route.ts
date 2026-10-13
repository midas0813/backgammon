import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/proxy";
import { clientKey, errorResponse, readJson, setSessionCookie } from "@/lib/server/http";
import { logIn, profileOf } from "@/lib/server/users";

/** POST /api/auth/login — { email, password }. Issues a fresh session token (prevents session fixation). */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const old = (await cookies()).get(SESSION_COOKIE)?.value;
    const { user, token } = logIn(old, body, await clientKey());
    await setSessionCookie(token);
    return Response.json(profileOf(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
