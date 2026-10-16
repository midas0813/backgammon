"use client";

import { useEffect, useState } from "react";
import { reportCrash } from "@/lib/client/crash";

/** What a player sees instead of a blank page when something breaks: a way back and a reference. */
export default function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    // Reported once per error; the reference is shown so support can find it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting is a side effect of the crash
    setRef(reportCrash(error));
  }, [error]);
  return (
    <main className="page">
      <div className="card error-card">
        <h1>Something went wrong</h1>
        <p className="muted">Sorry — this screen hit a problem. Your games are safe on the server. Try again, or go back to the lobby.</p>
        {ref && (
          <p className="small">
            Reference <strong className="mono">{ref}</strong>
          </p>
        )}
        <div className="grid2">
          <button className="btn primary" onClick={() => retry()}>
            Try again
          </button>
          <a className="btn" href="/play">
            Lobby
          </a>
        </div>
        <a className="btn ghost block" href={`/profile?error=${ref ?? ""}#support`}>
          Report this problem
        </a>
      </div>
    </main>
  );
}
