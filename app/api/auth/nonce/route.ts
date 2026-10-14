import { currentSession, errorResponse } from "@/lib/server/http";
import { createNonce } from "@/lib/server/siwe";

/** GET /api/auth/nonce — single-use SIWE nonce bound to this browser session (10-minute expiry). */
export async function GET() {
  try {
    const { token } = await currentSession();
    return new Response(await createNonce(token), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
