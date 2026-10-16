import type { NextRequest } from "next/server";
import { chatSince, sendChat } from "@/lib/server/chat";
import { handle, readJson } from "@/lib/server/http";

/** GET /api/matches/:id/chat?after=<id> — newer messages for this viewer. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/matches/[id]/chat">) {
  const { id } = await ctx.params;
  const after = Number(req.nextUrl.searchParams.get("after") ?? 0);
  return handle((user) => chatSince(user.id, id, after));
}

/** POST /api/matches/:id/chat — { kind: "text", text } | { kind: "preset", preset } | { kind: "emoji", emoji }. */
export async function POST(req: Request, ctx: RouteContext<"/api/matches/[id]/chat">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return handle((user) => sendChat(user.id, id, body), { limit: "chat" });
}
