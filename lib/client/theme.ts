"use client";

import { useSyncExternalStore } from "react";
import tokens from "../design-tokens.json";

export type BoardTheme = (typeof tokens.themes)[number];
export const THEMES: BoardTheme[] = tokens.themes;
export const BOARD = tokens.board;

const KEY = "bg-theme";
const EVENT = "bg-theme-change";

function readTheme(): string {
  try {
    return localStorage.getItem(KEY) ?? "walnut";
  } catch {
    return "walnut";
  }
}

/** Board theme is a local visual preference; it never touches game state. Saved to the profile too. */
export function setThemeId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
  fetch("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeId: id }),
  }).catch(() => {});
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTheme(): BoardTheme {
  const id = useSyncExternalStore(subscribe, readTheme, () => "walnut");
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
