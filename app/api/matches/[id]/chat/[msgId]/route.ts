import { removeSpectatorByMessage, reportChat } from "@/lib/server/chat";
import { handle, readJson } from "@/lib/server/http";

/** POST /api/matches/:id/chat/:msgId — { action: "report" } (anyone) or { action: "remove-spectator" } (host). */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/chat/[msgId]">) {
  const { id, msgId } = await ctx.params;
  const body = await readJson(req);
  return handle(
    (user) => (body.action === "remove-spectator" ? removeSpectatorByMessage(user.id, id, Number(msgId)) : reportChat(user.id, id, Number(msgId))),
    { limit: body.action === "remove-spectator" ? "game" : "report" },
  );
}
