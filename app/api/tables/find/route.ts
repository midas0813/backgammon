import { handle, readJson } from "@/lib/server/http";
import { findGame } from "@/lib/server/lobby";

/** POST /api/tables/find — { targetPoints }: join the oldest compatible table, or open one. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => findGame(user.id, Number(body.targetPoints ?? 3)));
}
