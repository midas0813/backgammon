"use client";

import type { Profile } from "./me";

const AVATAR_PX = 512;

/** Centre-crop to a square and re-encode, so large phone photos upload quickly and strip EXIF data. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file couldn't be read as an image. Try a JPEG, PNG or WebP.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(AVATAR_PX, side);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.9));
  if (blob && blob.type === "image/webp") return blob;
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), "image/jpeg", 0.9));
}

export async function uploadAvatar(file: File): Promise<Profile> {
  const fd = new FormData();
  fd.append("avatar", await prepareAvatar(file), "avatar");
  const res = await fetch("/api/me/avatar", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Upload failed");
  return data as Profile;
}
