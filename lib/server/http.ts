import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/proxy";
import type { User } from "./store";
import { ApiError } from "./errors";
import { rateLimit, type LimitRule } from "./ratelimit";
import { resolveSession } from "./users";

/**
 * `Secure` follows the actual request protocol, not NODE_ENV: a Secure cookie is dropped on plain
 * http (e.g. testing a production build from a phone on the LAN), which made every request a new guest.
 */
async function cookieOptions() {
  const h = await headers();
  const https = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  return { httpOnly: true, sameSite: "lax" as const, secure: https, path: "/", maxAge: 60 * 60 * 24 * 365 };
}

/** The host the browser used — what the SIWE message's domain must match (proxies set x-forwarded-host). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "";
}

/** Resolve the session cookie (an opaque random token) to its user, creating a guest when new. */
export async function currentSession(): Promise<{ user: User; token: string }> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  const session = await resolveSession(existing);
  if (session.token !== existing) jar.set(SESSION_COOKIE, session.token, await cookieOptions());
  return session;
}

export async function currentUser(): Promise<User> {
  return (await currentSession()).user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, await cookieOptions());
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Best-effort client key for rate limiting (behind a proxy, configure the trusted forwarded header). */
export async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/**
 * Run a handler with the current user and map errors to the contract's error envelope. `limit`
 * counts the request against that rate-limit rule for the user first.
 */
export async function handle(fn: (user: User) => unknown | Promise<unknown>, opts: { limit?: LimitRule } = {}): Promise<Response> {
  try {
    const user = await currentUser();
    if (opts.limit) await rateLimit(opts.limit, user.id);
    const data = await fn(user);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e: unknown): Response {
  const referenceId = randomUUID().slice(0, 8);
  if (e instanceof ApiError) {
    const headers: Record<string, string> = typeof e.extra.retryAfter === "number" ? { "Retry-After": String(e.extra.retryAfter) } : {};
    return Response.json({ error: { code: e.code, message: e.message, referenceId, ...e.extra } }, { status: e.status, headers });
  }
  console.error(`[${referenceId}]`, e);
  return Response.json(
    { error: { code: "SERVICE_UNAVAILABLE", message: "Something went wrong. Please retry.", referenceId } },
    { status: 500 },
  );
}
