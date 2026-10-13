import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/proxy";
import { clearSessionCookie } from "@/lib/server/http";
import { logOut } from "@/lib/server/users";

export async function POST() {
  logOut((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
