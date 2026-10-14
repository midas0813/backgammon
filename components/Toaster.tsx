"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { dismiss, toastStore } from "@/lib/client/toast";

export default function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.server);
  if (!items.length) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-card ${t.tone ?? "info"}`}>
          <span>{t.text}</span>
          {t.action && (
            <Link className="btn sm primary" href={t.action.href} onClick={() => dismiss(t.id)}>
              {t.action.label}
            </Link>
          )}
          <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
