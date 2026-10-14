import { handle, readJson } from "@/lib/server/http";
import { createDispute, listDisputes } from "@/lib/server/disputes";

/** POST /api/disputes — { category, reason, matchId?, transactionId? } → { referenceId, status }. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => createDispute(user.id, body));
}

export async function GET() {
  return handle((user) => listDisputes(user.id));
}
