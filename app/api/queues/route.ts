import { handle, readJson } from "@/lib/server/http";
import { createMatch } from "@/lib/server/matches";

/**
 * POST /api/queues (spec 03) — join the free quick-match queue: { targetPoints }.
 * Returns the queue ticket (the match ID); it becomes active when an opponent is found.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(async (user) => {
    const { matchId } = await createMatch(user.id, "quick", Number(body.targetPoints ?? 3));
    return { ticket: matchId, matchId };
  });
}
