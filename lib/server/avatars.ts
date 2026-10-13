import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, transact } from "./db";
import { ApiError } from "./errors";

/**
 * Avatar storage. Files live outside /public (which is read-only after build) and are served by
 * /api/avatars/[file]. Production: move to object storage (S3/R2) behind the same interface.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const DIR = path.join(DATA_DIR, "avatars");
const NAME_RE = /^[0-9a-f-]{36}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

/** Identify the image type from its magic bytes — never trust the client's declared type. */
export function sniffImage(bytes: Uint8Array): keyof typeof TYPES | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length > 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function saveAvatar(userId: string, bytes: Uint8Array): string {
  if (bytes.length === 0) throw new ApiError(400, "INVALID_INPUT", "Choose an image to upload");
  if (bytes.length > MAX_AVATAR_BYTES) throw new ApiError(413, "INVALID_INPUT", "Image must be 2 MB or smaller");
  const ext = sniffImage(bytes);
  if (!ext) throw new ApiError(415, "INVALID_INPUT", "Use a PNG, JPEG or WebP image");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `${userId}-${hash}.${ext}`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, file), bytes);
  const previous = transact((db) => {
    const user = db.users[userId];
    const old = user.avatar;
    user.avatar = file;
    return old;
  });
  if (previous && previous !== file) fs.rmSync(path.join(DIR, previous), { force: true });
  return file;
}

export function removeAvatar(userId: string) {
  const previous = transact((db) => {
    const old = db.users[userId].avatar;
    delete db.users[userId].avatar;
    return old;
  });
  if (previous) fs.rmSync(path.join(DIR, previous), { force: true });
}

export function readAvatar(file: string): { bytes: Buffer; type: string } | null {
  if (!NAME_RE.test(file)) return null;
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return null;
  const ext = file.split(".").pop() as keyof typeof TYPES;
  return { bytes: fs.readFileSync(full), type: TYPES[ext] };
}
