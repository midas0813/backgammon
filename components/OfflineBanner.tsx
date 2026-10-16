"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** A banner while the device has no connection; games resume where they were when it returns. */
export default function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <span className="offline-dot" aria-hidden /> Offline — reconnecting… Your game continues when you&apos;re back.
    </div>
  );
}
