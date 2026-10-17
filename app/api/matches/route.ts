import { handle, readJson } from "@/lib/server/http";
import { createTable, lobby } from "@/lib/server/lobby";
import { createMatch } from "@/lib/server/matches";

/** GET /api/matches — same as GET /api/lobby. */
export async function GET() {
  return handle((user) => lobby(user.id));
}

/**
 * POST /api/matches — mode: bot | local, or quick (public table) | private (invite link), which go
 * through the same rules as POST /api/tables. Free only; one game at a time per player.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(
    (user) =>
      body.mode === "quick" || body.mode === "private"
        ? createTable(user.id, { ...body, visibility: body.mode === "private" ? "private" : "public" })
        : createMatch(user.id, body.mode as "bot", Number(body.targetPoints), { clientSeed: body.clientSeed }),
    { limit: "game" },
  );
}
