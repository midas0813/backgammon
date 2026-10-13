import { currentSession, errorResponse, readJson, setSessionCookie } from "@/lib/server/http";
import { profileOf, signUp } from "@/lib/server/users";

/** POST /api/auth/signup — { email, password, name, acceptTerms }. Upgrades the current guest in place. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const { token } = await currentSession();
    const result = signUp(token, body);
    if (result.token !== token) await setSessionCookie(result.token);
    return Response.json(profileOf(result.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
