import { submitFeedback } from "@/lib/server/beta";
import { handle, readJson } from "@/lib/server/http";

/** POST /api/feedback — { kind: idea | bug | other, message, path }: straight to the admin area. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return handle((user) => submitFeedback(user.id, body, req.headers.get("user-agent") ?? undefined), { limit: "report" });
}
