"use client";

/** Report a crash the player saw; returns the reference number to show them. Never throws. */
export function reportCrash(error: Error & { digest?: string }) {
  const ref = (error.digest ?? Math.random().toString(16).slice(2, 10)).slice(0, 12);
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, message: error.message || "Unknown error", detail: error.stack, path: window.location.pathname }),
    keepalive: true,
  }).catch(() => {});
  return ref;
}
