import { clientKey, currentSession, errorResponse, readJson, requestHost, setSessionCookie } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { verifySiwe } from "@/lib/server/siwe";

/**
 * POST /api/auth/verify — { message, signature } from Sign-In with Ethereum.
 * The wallet address is the account: the first sign-in creates it, later ones return to it.
 */
export async function POST(req: Request) {
  try {
    await rateLimit("signin", await clientKey());
    const body = await readJson(req);
    const { token } = await currentSession();
    const host = await requestHost();
    const result = await verifySiwe({ sessionToken: token, host }, body);
    await setSessionCookie(result.token);
    return Response.json({ isNew: result.isNew, profile: result.profile });
  } catch (e) {
    return errorResponse(e);
  }
}
