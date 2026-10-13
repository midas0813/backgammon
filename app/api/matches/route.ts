import { handle, readJson } from "@/lib/server/http";
import { createMatch, listMatches } from "@/lib/server/matches";

export async function GET() {
  return handle((user) => listMatches(user.id));
}

/** POST /api/matches — mode: quick (queue) | private (invite link) | local (pass & play). Free only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => createMatch(user.id, body.mode as "quick", Number(body.targetPoints)));
}
