"use client";

import { useEffect } from "react";

const BEAT_MS = 25_000;

/** Keeps "players online" accurate: a heartbeat while the app is visible, a goodbye when it's not. */
export default function OnlineHeartbeat() {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void fetch("/api/presence", { method: "POST", keepalive: true }).catch(() => {});
    };
    const away = () => navigator.sendBeacon?.("/api/presence?away=1");
    beat();
    const t = window.setInterval(beat, BEAT_MS);
    const onVisibility = () => (document.visibilityState === "visible" ? beat() : away());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
    };
  }, []);
  return null;
}
