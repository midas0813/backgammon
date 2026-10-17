import { handle } from "@/lib/server/http";
import { listTournaments } from "@/lib/server/tournaments";

/** GET /api/tournaments — open tables, running brackets and recent winners. */
export async function GET() {
  return handle((user) => listTournaments(user.id));
}
