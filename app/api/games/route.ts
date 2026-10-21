import { handle } from "@/lib/server/http";
import { gamesHub } from "@/lib/server/hub";

/** GET /api/games — every game with its activity and your level and rating in it (the Play hub). */
export async function GET() {
  return handle((user) => gamesHub(user.id));
}
