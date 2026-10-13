import { handle, readJson } from "@/lib/server/http";
import { unlinkWallet } from "@/lib/server/walletLink";

/** DELETE /api/wallet/connect — { address } unlinks a wallet from the account. */
export async function DELETE(req: Request) {
  const body = await readJson(req);
  return handle((user) => ({ wallets: unlinkWallet(user.id, body.address) }));
}
