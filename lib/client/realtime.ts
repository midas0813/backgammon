"use client";

import { useEffect, useState } from "react";
import { useLatest } from "./hooks";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Whether instant updates are configured for this deployment. */
export const realtimeEnabled = !!(URL_ && KEY);

type Client = InstanceType<typeof import("@supabase/realtime-js").RealtimeClient>;
let client: Promise<Client> | null = null;
function getClient() {
  client ??= import("@supabase/realtime-js").then(({ RealtimeClient }) => {
    const c = new RealtimeClient(`${URL_!.replace(/^http/, "ws").replace(/\/$/, "")}/realtime/v1`, { params: { apikey: KEY! } });
    c.connect();
    return c;
  });
  return client;
}

/**
 * Listen for "something changed" notices on a match's channel (see lib/server/realtime.ts). Returns
 * whether the channel is connected, so the page can poll slowly while it is and quickly while not.
 * Notices carry no game data; the handler always fetches the real state from the server.
 */
export function useMatchChannel(matchId: string, onNotice: (event: string) => void) {
  const [live, setLive] = useState(false);
  const handler = useLatest(onNotice);
  useEffect(() => {
    if (!realtimeEnabled) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    getClient()
      .then((c) => {
        if (stopped) return;
        const ch = c.channel(`match:${matchId}`);
        ch.on("broadcast", { event: "*" }, (m: { event: string }) => handler.current(m.event));
        ch.subscribe((status: string) => setLive(status === "SUBSCRIBED"));
        unsubscribe = () => {
          c.removeChannel(ch);
        };
      })
      .catch(() => {});
    return () => {
      stopped = true;
      setLive(false);
      unsubscribe?.();
    };
  }, [matchId, handler]);
  return live;
}
