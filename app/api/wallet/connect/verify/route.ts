import { currentSession, errorResponse, readJson } from "@/lib/server/http";
import { verifyAndLink } from "@/lib/server/walletLink";

/** POST /api/wallet/connect/verify — { address, signature, chainId } → linked wallets. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const { token } = await currentSession();
    return Response.json({ wallets: await verifyAndLink(token, body) });
  } catch (e) {
    return errorResponse(e);
  }
}
