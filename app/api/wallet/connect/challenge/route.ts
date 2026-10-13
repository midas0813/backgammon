import { headers } from "next/headers";
import { currentSession, errorResponse, readJson } from "@/lib/server/http";
import { createChallenge } from "@/lib/server/walletLink";

/** POST /api/wallet/connect/challenge — { address, chainId } → one-time message to sign. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const { token } = await currentSession();
    const host = (await headers()).get("host") ?? "backgammon";
    return Response.json(createChallenge(token, body.address, body.chainId, host));
  } catch (e) {
    return errorResponse(e);
  }
}
