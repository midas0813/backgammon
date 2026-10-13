import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "./db";
import { ApiError } from "./errors";
import { ensureUser } from "./users";

import { GUEST_COOKIE as COOKIE } from "@/proxy";

/** Resolve (or create) the guest user from an httpOnly cookie. */
export async function currentUser(): Promise<User> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const user = ensureUser(existing);
  if (user.id !== existing) {
    jar.set(COOKIE, user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return user;
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
