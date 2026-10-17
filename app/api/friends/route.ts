import { handle } from "@/lib/server/http";
import { listFriends } from "@/lib/server/social";

/** GET /api/friends — friends (online first) and pending requests. */
export async function GET() {
  return handle((user) => listFriends(user.id));
}
