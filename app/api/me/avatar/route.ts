import { ApiError } from "@/lib/server/errors";
import { handle } from "@/lib/server/http";
import { MAX_AVATAR_BYTES, removeAvatar, saveAvatar } from "@/lib/server/avatars";
import { profileOf } from "@/lib/server/users";

/** POST /api/me/avatar — multipart field "avatar" (PNG/JPEG/WebP, ≤ 2 MB). */
export async function POST(req: Request) {
  return handle(async (user) => {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_AVATAR_BYTES + 64 * 1024) throw new ApiError(413, "INVALID_INPUT", "Image must be 2 MB or smaller");
    const form = await req.formData().catch(() => null);
    const file = form?.get("avatar");
    if (!(file instanceof Blob)) throw new ApiError(400, "INVALID_INPUT", "Choose an image to upload");
    saveAvatar(user.id, new Uint8Array(await file.arrayBuffer()));
    return profileOf(user.id);
  });
}

export async function DELETE() {
  return handle((user) => {
    removeAvatar(user.id);
    return profileOf(user.id);
  });
}
