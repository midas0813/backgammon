import { adminHandle } from "@/lib/server/admin/http";
import { listTournamentsAdmin, saveTournamentSeries } from "@/lib/server/admin/service";
import { readJson } from "@/lib/server/http";

/** GET /api/admin/tournaments — series (with rewards) and recent tournaments. */
export async function GET() {
  return adminHandle("matches.view", (ctx) => listTournamentsAdmin(ctx));
}

/** PUT /api/admin/tournaments — { series: TournamentSeries[] } replaces the list. */
export async function PUT(req: Request) {
  const body = await readJson(req);
  return adminHandle("tournaments.manage", (ctx) => saveTournamentSeries(ctx, body));
}
