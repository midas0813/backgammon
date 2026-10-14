import { readAvatar } from "@/lib/server/avatars";

/** GET /api/avatars/:file — public avatar images (file names are content-hashed, so cache forever). */
export async function GET(_req: Request, ctx: RouteContext<"/api/avatars/[file]">) {
  const { file } = await ctx.params;
  const avatar = await readAvatar(file);
  if (!avatar) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
