import { handle, readJson } from "@/lib/server/http";
import { profileOf, updatePreferences } from "@/lib/server/users";

export async function GET() {
  return handle((user) => profileOf(user.id));
}

/** PATCH /api/me — name, bio, country, themeId, reducedMotion. */
export async function PATCH(req: Request) {
  const body = await readJson(req);
  return handle((user) => updatePreferences(user.id, body), { limit: "profile" });
}
