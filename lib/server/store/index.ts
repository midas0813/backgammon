import path from "node:path";
import postgres from "postgres";
import { createMemoryStore } from "./memory";
import { createPostgresStore, type Driver } from "./postgres";
import type { Store, Tx } from "./types";

export type * from "./types";

/**
 * Store selection:
 *  - DATABASE_URL set → Postgres (Supabase). Use the pooler connection string; prepared statements are
 *    disabled so it works in transaction-pooling mode (port 6543).
 *  - otherwise → local JSON file (.data/db.json), or memory when BG_DB_FILE=":memory:" (tests).
 */
function postgresJsDriver(url: string): Driver {
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connection: { application_name: "backgammon-mvp" },
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  });
  return {
    begin: (fn) => sql.begin((t) => fn((text, params) => t.unsafe(text, (params ?? []) as never[]) as never)) as never,
  };
}

const g = globalThis as unknown as { __bgStore?: Store };

export function getStore(): Store {
  if (g.__bgStore) return g.__bgStore;
  const url = process.env.DATABASE_URL;
  if (url) {
    g.__bgStore = createPostgresStore(postgresJsDriver(url));
  } else {
    const file = process.env.BG_DB_FILE ?? path.join(process.cwd(), ".data", "db.json");
    g.__bgStore = createMemoryStore(file === ":memory:" ? null : file);
  }
  return g.__bgStore;
}

/** Tests: swap in a specific store (e.g. PGlite-backed Postgres). */
export function setStore(store: Store) {
  g.__bgStore = store;
}

export function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  return getStore().tx(fn);
}
