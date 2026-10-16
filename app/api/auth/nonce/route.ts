import { clientKey, currentSession, errorResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { createNonce } from "@/lib/server/siwe";

/** GET /api/auth/nonce — single-use SIWE nonce bound to this browser session (10-minute expiry). */
export async function GET() {
  try {
    await rateLimit("signin", await clientKey());
    const { token } = await currentSession();
    return new Response(await createNonce(token), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
