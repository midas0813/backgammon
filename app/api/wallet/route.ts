import { handle } from "@/lib/server/http";
import { getWallet } from "@/lib/server/wallet";

export async function GET() {
  return handle((user) => getWallet(user.id));
}
