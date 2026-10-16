import { createChallenge, type ChallengeDetails } from "@/lib/server/admin/auth";
import { currentAdmin } from "@/lib/server/admin/http";
import { currentUser, errorResponse, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

/**
 * POST /api/admin/challenge — { action, target?, reason? }: a message for the wallet to sign.
 * ADMIN_SIGN_IN needs only a wallet account; any other action needs an unlocked admin session.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const user = await currentUser();
    await rateLimit("admin", user.id);
    const action = String(body.action ?? "") as ChallengeDetails["action"];
    if (action !== "ADMIN_SIGN_IN") await currentAdmin(null);
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : undefined);
    return Response.json(await createChallenge(user, { action, target: str(body.target), reason: str(body.reason) }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
