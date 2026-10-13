import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE = "bg_sid";

/**
 * Issue the opaque session cookie on the first request, before any page or API handler runs.
 * Without this, the lobby's parallel first API calls would each mint a different guest.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const id = crypto.randomUUID();
  request.cookies.set(SESSION_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
