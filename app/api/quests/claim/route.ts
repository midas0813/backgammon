import { handle, readJson } from "@/lib/server/http";
import { claimQuest } from "@/lib/server/quests";

/** POST /api/quests/claim — { questId }: collect a completed quest's reward. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => claimQuest(user.id, body.questId), { limit: "profile" });
}
