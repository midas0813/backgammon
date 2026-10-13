import { handle, readJson } from "@/lib/server/http";
import { updatePreferences } from "@/lib/server/users";

export async function GET() {
  return handle((user) => user);
}

/** PATCH /api/me — saved preferences only (name, themeId, reducedMotion). */
export async function PATCH(req: Request) {
  const body = await readJson(req);
  return handle((user) => updatePreferences(user.id, body));
}
