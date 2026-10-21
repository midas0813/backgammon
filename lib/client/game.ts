"use client";

import { useSyncExternalStore } from "react";
import { isGameType, type GameType } from "@/lib/games";

/** The game the player is browsing (Play, Ranks, Tournaments), remembered on this device. */
const KEY = "bg:game";
const listeners = new Set<() => void>();

function read(): GameType {
  try {
    const v = localStorage.getItem(KEY);
    return isGameType(v) ? v : "backgammon";
  } catch {
    return "backgammon";
  }
}

export function setCurrentGame(game: GameType) {
  try {
    localStorage.setItem(KEY, game);
  } catch {}
  listeners.forEach((l) => l());
}

export function useCurrentGame(): GameType {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "backgammon",
  );
}

/** The lobby page of a game. */
export const lobbyPath = (game: GameType) => (game === "chess" ? "/play/chess" : "/play");
