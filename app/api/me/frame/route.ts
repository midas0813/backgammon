import { handle, readJson } from "@/lib/server/http";
import { setFrame } from "@/lib/server/quests";

/** POST /api/me/frame — { frame }: wear an avatar frame your level has unlocked. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => setFrame(user.id, body.frame), { limit: "profile" });
}
