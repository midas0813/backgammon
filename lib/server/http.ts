import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/proxy";
import type { User } from "./store";
import { ApiError } from "./errors";
import { resolveSession } from "./users";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

/** Resolve the session cookie (an opaque random token) to its user, creating a guest when new. */
export async function currentSession(): Promise<{ user: User; token: string }> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  const session = await resolveSession(existing);
  if (session.token !== existing) jar.set(SESSION_COOKIE, session.token, COOKIE_OPTIONS);
  return session;
}

export async function currentUser(): Promise<User> {
  return (await currentSession()).user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, COOKIE_OPTIONS);
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

/** Run a handler with the current user and map errors to the contract's error envelope. */
export async function handle(fn: (user: User) => unknown | Promise<unknown>): Promise<Response> {
  try {
    const user = await currentUser();
    const data = await fn(user);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e: unknown): Response {
  const referenceId = randomUUID().slice(0, 8);
  if (e instanceof ApiError) {
    return Response.json({ error: { code: e.code, message: e.message, referenceId, ...e.extra } }, { status: e.status });
  }
  console.error(`[${referenceId}]`, e);
  return Response.json(
    { error: { code: "SERVICE_UNAVAILABLE", message: "Something went wrong. Please retry.", referenceId } },
    { status: 500 },
  );
}
