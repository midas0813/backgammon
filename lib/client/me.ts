"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Profile } from "@/lib/server/users";
import { api } from "./api";

/** Shared, client-side cache of the signed-in (or guest) profile so the header and pages stay in sync. */
let current: Profile | null = null;
let inflight: Promise<Profile> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  if (typeof document !== "undefined" && current) {
    document.documentElement.dataset.reducedMotion = String(current.reducedMotion);
  }
}

export function setMe(p: Profile) {
  current = p;
  emit();
}

export function refreshMe(): Promise<Profile> {
  inflight ??= api<Profile>("/api/me")
    .then((p) => {
      setMe(p);
      return p;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useMe(): Profile | null {
  const me = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
  useEffect(() => {
    if (!current) refreshMe().catch(() => {});
  }, []);
  return me;
}

export type { Profile };
