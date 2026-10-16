import { after } from "next/server";
import { tx, type AppError } from "./store";

/**
 * Error monitoring (G4). Every unexpected server error and every crash a player hits in the browser is
 * stored with the reference number the player saw, shown on the admin dashboard, and — when
 * DISCORD_WEBHOOK_URL is set — reported to the team's Discord channel: at once for anything touching
 * payments, otherwise when errors spike.
 */
const SPIKE_WINDOW_MS = 5 * 60_000;
const SPIKE_COUNT = 5;
const ALERT_EVERY_MS = 10 * 60_000;
const PAYMENT_RE = /payment|deposit|withdraw|purchase|ledger|wallet/i;

const state = ((globalThis as unknown as { __bgMonitor?: { lastAlert: number } }).__bgMonitor ??= { lastAlert: 0 });

const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined);

/** Post a message to the team's Discord channel, if configured. Never throws. */
export async function alertTeam(text: string) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
}

export async function recordError(e: Omit<AppError, "id" | "createdAt">) {
  const row = { ...e, message: clip(e.message, 500) ?? "Unknown error", detail: clip(e.detail, 4000), path: clip(e.path, 300) };
  try {
    const recent = await tx(async (t) => {
      await t.errors.add(row);
      return t.errors.countSince(Date.now() - SPIKE_WINDOW_MS);
    });
    const payment = PAYMENT_RE.test(`${row.message} ${row.path ?? ""} ${row.detail ?? ""}`);
    const now = Date.now();
    if (payment || (recent >= SPIKE_COUNT && now - state.lastAlert >= ALERT_EVERY_MS)) {
      if (!payment) state.lastAlert = now;
      await alertTeam(
        payment
          ? `⚠️ Payment-related error ${row.ref} (${row.source}): ${row.message}`
          : `⚠️ ${recent} errors in the last 5 minutes. Latest ${row.ref} (${row.source}): ${row.message}`,
      );
    }
  } catch (err) {
    // Monitoring must never break the request; the platform log still has it.
    console.error("[monitor] could not record error", err);
  }
}

/** Record after the response is sent; outside a request (tests), right away. */
export function recordErrorSoon(e: Omit<AppError, "id" | "createdAt">) {
  try {
    after(() => recordError(e));
  } catch {
    void recordError(e);
  }
}
