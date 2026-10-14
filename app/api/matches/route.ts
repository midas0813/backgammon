import { handle, readJson } from "@/lib/server/http";
import { lobby } from "@/lib/server/lobby";
import { createMatch } from "@/lib/server/matches";

/** GET /api/matches — same as GET /api/lobby. */
export async function GET() {
  return handle((user) => lobby(user.id));
}

/** POST /api/matches — mode: bot | local | quick (find a game) | private (invite link). Free only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) =>
    createMatch(user.id, body.mode as "quick", Number(body.targetPoints), { allowSpectators: body.allowSpectators !== false }),
  );
}
