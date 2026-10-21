"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's 3D arena. three.js loads after the page (only here, never in the app), and the CSS
 * backdrop behind it stays if WebGL is unavailable. Reduced motion gets a still frame.
 */
export default function ArenaScene() {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true";
    import("./arena-three")
      .then(({ mountArena }) => {
        if (cancelled) return;
        stop = mountArena(el, { still });
        setState("ready");
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return <div ref={host} className={`l-scene ${state}`} aria-hidden />;
}
