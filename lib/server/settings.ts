import type { Tx } from "./store";

/** Operator switches, edited in the admin area (Owner) and read on hot paths through a short cache. */
export interface OperatorSettings {
  /** Blocks new matches and tables; games in progress continue. */
  maintenance: { enabled: boolean; message: string };
  /** Global switch for watching other players' matches. */
  spectators: boolean;
}

export const DEFAULT_SETTINGS: OperatorSettings = {
  maintenance: { enabled: false, message: "We are doing quick maintenance. New matches will open again shortly." },
  spectators: true,
};

const CACHE_MS = 10_000;
const cache = ((globalThis as unknown as { __bgSettings?: { at: number; value: OperatorSettings } }).__bgSettings ??= {
  at: 0,
  value: DEFAULT_SETTINGS,
});

export function mergeSettings(raw: Record<string, unknown>): OperatorSettings {
  const m = (raw.maintenance ?? {}) as Partial<OperatorSettings["maintenance"]>;
  return {
    maintenance: {
      enabled: typeof m.enabled === "boolean" ? m.enabled : DEFAULT_SETTINGS.maintenance.enabled,
      message: typeof m.message === "string" && m.message.trim() ? m.message : DEFAULT_SETTINGS.maintenance.message,
    },
    spectators: typeof raw.spectators === "boolean" ? raw.spectators : DEFAULT_SETTINGS.spectators,
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
