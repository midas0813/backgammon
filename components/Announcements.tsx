"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

interface Data {
  announcements: { id: string; message: string; tone: "info" | "warn" | "ok" }[];
  maintenance: string | null;
}

const KEY = "bg:dismissed-announcements";
function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Operator announcements and the maintenance notice (set in the admin area). */
export default function Announcements() {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    setHidden(dismissed());
    const load = () => api<Data>("/api/announcements").then(setData).catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);
  if (!data) return null;
  const items = data.announcements.filter((a) => !hidden.includes(a.id));
  return (
    <>
      {data.maintenance && (
        <div className="announce warn" role="status">
          <strong>Maintenance:</strong> {data.maintenance}
        </div>
      )}
      {items.map((a) => (
        <div key={a.id} className={`announce ${a.tone}`} role="status">
          <span>{a.message}</span>
          <button
            className="toast-x"
            aria-label="Dismiss"
            onClick={() => {
              const next = [...hidden, a.id].slice(-20);
              setHidden(next);
              try {
                localStorage.setItem(KEY, JSON.stringify(next));
              } catch {}
            }}
          >
            ×
          </button>
        </div>
      ))}
    </>
  );
}
