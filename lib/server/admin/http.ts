import { cookies, headers } from "next/headers";
import { currentUser, errorResponse } from "../http";
import { ADMIN_MAX_MS, resolveAdmin, type AdminContext, type Permission, type RequestMeta } from "./auth";

export const ADMIN_COOKIE = "bg_admin";

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

/** The admin session for this request (the game session must belong to the same wallet user). */
export async function currentAdmin(perm: Permission | null): Promise<AdminContext> {
  const user = await currentUser();
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return resolveAdmin(token, user.id, perm, await requestMeta());
}

/** Run an admin handler: resolve the session with `perm`, map errors to the standard envelope. */
export async function adminHandle(perm: Permission | null, fn: (ctx: AdminContext) => unknown | Promise<unknown>): Promise<Response> {
  try {
    const ctx = await currentAdmin(perm);
    const data = await fn(ctx);
    return Response.json(data, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function setAdminCookie(token: string) {
  const h = await headers();
  const https = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  (await cookies()).set(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: https, path: "/", maxAge: ADMIN_MAX_MS / 1000 });
}

export async function clearAdminCookie() {
  (await cookies()).delete(ADMIN_COOKIE);
}
