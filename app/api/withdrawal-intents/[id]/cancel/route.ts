import { handle } from "@/lib/server/http";
import { cancelWithdrawal } from "@/lib/server/wallet";

export async function POST(_req: Request, ctx: RouteContext<"/api/withdrawal-intents/[id]/cancel">) {
  const { id } = await ctx.params;
  return handle((user) => cancelWithdrawal(user.id, id));
}
