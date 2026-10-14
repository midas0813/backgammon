import { handle, readJson } from "@/lib/server/http";
import { updatePreferences } from "@/lib/server/users";

/** PATCH /api/me/preferences (spec 03) — themeId, orientation, sound, reducedMotion, highContrast. */
export async function PATCH(req: Request) {
  const body = await readJson(req);
  return handle((user) => updatePreferences(user.id, body));
}
