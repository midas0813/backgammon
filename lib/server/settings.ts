import type { Tx } from "./store";

/** Operator switches, edited in the admin area (Owner) and read on hot paths through a short cache. */
export interface OperatorSettings {
  /** Blocks new matches and tables; games in progress continue. */
  maintenance: { enabled: boolean; message: string };
  /** Global switch for watching other players' matches. */
  spectators: boolean;
  /** Spectators of ranked and tournament matches see them this many seconds late (0 = live). */
  spectatorDelaySec: number;
  /** Weekly free prize pool for the leaderboard (amount in token minor units; split in percent). */
  prizePool: { enabled: boolean; units: number; split: number[]; minOpponents: number };
}

export const DEFAULT_SETTINGS: OperatorSettings = {
  maintenance: { enabled: false, message: "We are doing quick maintenance. New matches will open again shortly." },
  spectators: true,
  spectatorDelaySec: 20,
  prizePool: { enabled: true, units: 5000, split: [50, 30, 20], minOpponents: 5 },
};

const CACHE_MS = 10_000;
const cache = ((globalThis as unknown as { __bgSettings?: { at: number; value: OperatorSettings } }).__bgSettings ??= {
  at: 0,
  value: DEFAULT_SETTINGS,
});

function mergePrizePool(raw: unknown): OperatorSettings["prizePool"] {
  const d = DEFAULT_SETTINGS.prizePool;
  const p = (raw ?? {}) as Partial<OperatorSettings["prizePool"]>;
  const split = Array.isArray(p.split) && p.split.length >= 1 && p.split.length <= 10 && p.split.every((x) => Number.isInteger(x) && x > 0) ? p.split : d.split;
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : d.enabled,
    units: Number.isSafeInteger(p.units) && p.units! >= 0 && p.units! <= 10_000_000 ? p.units! : d.units,
    split: split.reduce((a, b) => a + b, 0) <= 100 ? split : d.split,
    minOpponents: Number.isInteger(p.minOpponents) && p.minOpponents! >= 1 && p.minOpponents! <= 50 ? p.minOpponents! : d.minOpponents,
  };
}

export function mergeSettings(raw: Record<string, unknown>): OperatorSettings {
  const m = (raw.maintenance ?? {}) as Partial<OperatorSettings["maintenance"]>;
  return {
    maintenance: {
      enabled: typeof m.enabled === "boolean" ? m.enabled : DEFAULT_SETTINGS.maintenance.enabled,
      message: typeof m.message === "string" && m.message.trim() ? m.message : DEFAULT_SETTINGS.maintenance.message,
    },
    spectators: typeof raw.spectators === "boolean" ? raw.spectators : DEFAULT_SETTINGS.spectators,
    prizePool: mergePrizePool(raw.prizePool),
    spectatorDelaySec:
      Number.isInteger(raw.spectatorDelaySec) && (raw.spectatorDelaySec as number) >= 0 && (raw.spectatorDelaySec as number) <= 600
        ? (raw.spectatorDelaySec as number)
        : DEFAULT_SETTINGS.spectatorDelaySec,
  };
}

export async function operatorSettings(t: Tx, fresh = false): Promise<OperatorSettings> {
  const now = Date.now();
  if (!fresh && now - cache.at < CACHE_MS) return cache.value;
  cache.value = mergeSettings(await t.admin.allSettings());
  cache.at = now;
  return cache.value;
}

/** After an admin change, and in tests. */
export function invalidateSettings() {
  cache.at = 0;
}
