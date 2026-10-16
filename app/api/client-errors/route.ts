import { handle, readJson } from "@/lib/server/http";
import { recordError } from "@/lib/server/monitor";

/** POST /api/client-errors — { ref, message, detail?, path? }: a crash a player saw in the browser. */
export async function POST(req: Request) {
  const body = await readJson(req);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  return handle(
    async (user) => {
      const ref = str(body.ref, 16)?.replace(/[^0-9a-zA-Z-]/g, "");
      if (!ref) return { ok: false };
      await recordError({
        ref,
        source: "client",
        message: str(body.message, 500) ?? "Unknown error",
        detail: str(body.detail, 4000),
        path: str(body.path, 300),
        userId: user.id,
      });
      return { ok: true };
    },
    { limit: "report" },
  );
}
