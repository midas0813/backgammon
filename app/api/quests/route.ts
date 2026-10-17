import { handle } from "@/lib/server/http";
import { questBoard } from "@/lib/server/quests";

/** GET /api/quests — today's and this week's quests with progress, plus XP and level. */
export async function GET() {
  return handle((user) => questBoard(user.id));
}
