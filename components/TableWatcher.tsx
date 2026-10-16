"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/client/api";
import { useLatest } from "@/lib/client/hooks";
import { useMe } from "@/lib/client/me";
import { sounds } from "@/lib/client/sound";
import { onTablesChange, unwatchTable, watchedTables } from "@/lib/client/tables";
import { toast } from "@/lib/client/toast";

interface Status {
  tables: { matchId: string; status: string; opponent: string | null; reason: string | null }[];
}

/** Anywhere in the app: when someone joins a table you host, say so and take you to the board. */
export default function TableWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const pathRef = useLatest(pathname);
  const soundRef = useLatest(me?.sound ?? true);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const tick = async () => {
      const ids = watchedTables();
      if (ids.length && document.visibilityState === "visible") {
        try {
          const { tables } = await api<Status>(`/api/tables/status?ids=${ids.join(",")}`);
          const known = new Set(tables.map((t) => t.matchId));
          for (const id of ids) if (!known.has(id)) unwatchTable(id);
          for (const t of tables) {
            if (t.status === "WAITING") continue;
            unwatchTable(t.matchId);
            const href = `/match/${t.matchId}`;
            if (t.status === "ACTIVE") {
              if (soundRef.current) sounds.joined();
              navigator.vibrate?.([60, 40, 60]);
              if (pathRef.current !== href) {
                toast(`${t.opponent ?? "An opponent"} joined your table!`, { tone: "ok", action: { label: "Play", href } });
                if (!pathRef.current.startsWith("/match/")) router.push(href);
              }
            } else if (t.status === "CANCELLED" && pathRef.current !== href && t.reason !== "ended") {
              toast(
                t.reason === "host-missing"
                  ? "Someone joined your table while you were away, and the match was called off."
                  : "Your table closed after waiting too long.",
                { tone: "warn" },
              );
            }
          }
        } catch {}
      }
      if (!stopped) timer = window.setTimeout(tick, watchedTables().length ? 3000 : 10000);
    };
    tick();
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 300);
    };
    const off = onTablesChange(soon);
    // Coming back to the app (e.g. unlocking the phone): check at once, a joiner may be waiting.
    const onVisible = () => document.visibilityState === "visible" && soon();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, pathRef, soundRef]);
  return null;
}
