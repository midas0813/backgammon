import { after } from "next/server";

/**
 * Instant updates (Supabase Realtime broadcast). After a match changes, a short notice goes out on
 * the public channel `match:<id>`; open match pages fetch the new state at once instead of waiting
 * for their next poll. The notice carries no game data (anyone could send one to a public channel),
 * only "something changed": the client always reads the real state from the server.
 * Off when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set; pages poll.
 */
export function realtimeConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

export type RealtimeEvent = "match" | "chat";

export function publish(matchId: string, event: RealtimeEvent, payload: Record<string, unknown> = {}) {
  const cfg = realtimeConfig();
  if (!cfg) return;
  const send = () =>
    fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        // Legacy anon keys are JWTs and also go in Authorization; new publishable keys only in apikey.
        ...(cfg.key.startsWith("eyJ") ? { Authorization: `Bearer ${cfg.key}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ topic: `match:${matchId}`, event, payload, private: false }] }),
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => {
        if (!r.ok) console.warn(`[realtime] broadcast failed: ${r.status}`);
      })
      .catch(() => {});
  // Sent after the response so a move is never slowed down; outside a request (tests), right away.
  try {
    after(send);
  } catch {
    void send();
  }
}
