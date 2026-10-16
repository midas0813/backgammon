import { createHash } from "node:crypto";
import { ApiError } from "./errors";
import { tx } from "./store";
import { profileIn } from "./users";

/**
 * Avatars are stored in the database (app_avatars, ≤ 2 MB, already re-encoded to ~25 KB by the
 * browser) and served by /api/avatars/[file] with immutable caching. A CDN/object store (Supabase
 * Storage) can replace this behind the same functions later.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const NAME_RE = /^[0-9a-f-]{36}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

/** Identify the image type from its magic bytes — never trust the client's declared type. */
export function sniffImage(bytes: Uint8Array): keyof typeof TYPES | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") {
    return "webp";
  }
  return null;
}

export async function saveAvatar(userId: string, bytes: Uint8Array) {
  if (bytes.length === 0) throw new ApiError(400, "INVALID_INPUT", "Choose an image to upload");
  if (bytes.length > MAX_AVATAR_BYTES) throw new ApiError(413, "INVALID_INPUT", "Image must be 2 MB or smaller");
  const ext = sniffImage(bytes);
  if (!ext) throw new ApiError(415, "INVALID_INPUT", "Use a PNG, JPEG or WebP image");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `${userId}-${hash}.${ext}`;
  return tx(async (t) => {
    const user = (await t.users.get(userId))!;
    await t.avatars.put({ file, userId, contentType: TYPES[ext], bytes });
    if (user.avatar && user.avatar !== file) await t.avatars.delete(user.avatar);
    user.avatar = file;
    await t.users.put(user);
    return profileIn(t, userId);
  });
}

export async function removeAvatar(userId: string) {
  return tx(async (t) => {
    const user = (await t.users.get(userId))!;
    if (user.avatar) await t.avatars.delete(user.avatar);
    delete user.avatar;
    await t.users.put(user);
    return profileIn(t, userId);
  });
}

export async function readAvatar(file: string) {
  if (!NAME_RE.test(file)) return null;
  const a = await tx((t) => t.avatars.get(file));
  return a ? { bytes: a.bytes, type: a.contentType } : null;
}
