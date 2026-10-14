import { handle, readJson } from "@/lib/server/http";
import { createTable } from "@/lib/server/lobby";

/** POST /api/tables — { targetPoints, visibility: "public" | "private", allowSpectators }. Free only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => createTable(user.id, body));
}
