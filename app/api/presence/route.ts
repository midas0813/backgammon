import { handle } from "@/lib/server/http";
import { ONLINE_WINDOW_MS } from "@/lib/server/lobby";
import { pendingInvites } from "@/lib/server/social";
import { readyMatches } from "@/lib/server/tournaments";
import { tx } from "@/lib/server/store";

/**
 * POST /api/presence — the app is open and visible (heartbeat); returns invites waiting for you. `?away=1` (sent when the page is
 * closed or hidden): stop counting this player as online.
 */
export async function POST(req: Request) {
  const away = new URL(req.url).searchParams.get("away") === "1";
  return handle((user) =>
    tx(async (t) => {
      const now = Date.now();
      if (away) await t.users.markAway(user.id, now - ONLINE_WINDOW_MS - 1000);
      else await t.users.touchSeen(user.id, now);
      return { ok: true };
    }).then(async (r) => (away ? r : { ...r, invites: await pendingInvites(user.id), ready: await readyMatches(user.id) })),
  );
}
