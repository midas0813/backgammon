import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { ApiError } from "../errors";
import { createMemoryStore } from "./memory";
import { createPostgresStore, type Driver, type Migration } from "./postgres";
import type { Store, Tx } from "./types";

export type * from "./types";

const ALLOWED_PARAMS = new Set(["sslmode"]);

/**
 * The Postgres connection string, from (in order):
 *  1. DATABASE_URL — set by hand (Supabase → Connect → Transaction pooler, port 6543)
 *  2. POSTGRES_URL / POSTGRES_PRISMA_URL — set automatically by the Vercel ↔ Supabase integration
 *  3. POSTGRES_HOST + POSTGRES_PASSWORD (+ USER, DATABASE) — the same integration's separate parts
 * Provider-specific query parameters (e.g. `supa=`, `pgbouncer=`) are removed: postgres.js would send
 * them to the server as connection settings and the connection would be refused.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  let raw = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || "";
  if (!raw && env.POSTGRES_HOST && env.POSTGRES_PASSWORD) {
    const user = encodeURIComponent(env.POSTGRES_USER ?? "postgres");
    const pass = encodeURIComponent(env.POSTGRES_PASSWORD);
    raw = `postgresql://${user}:${pass}@${env.POSTGRES_HOST}:6543/${env.POSTGRES_DATABASE ?? "postgres"}`;
  }
  if (!raw) return null;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (!ALLOWED_PARAMS.has(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

/** SQL files in supabase/migrations — bundled into every server function via next.config.ts. */
export function loadMigrations(): Migration[] {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, name), "utf8") }));
}

export function postgresJsDriver(url: string): Driver {
  const sql = postgres(url, {
    prepare: false, // required for Supabase's transaction pooler (port 6543)
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    connection: { application_name: "backgammon-mvp" },
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    // The store already passes JSON text; the default serializer would stringify it again and
    // store a JSON string scalar that `data->'state'` cannot see into.
    types: {
      json: {
        to: 114,
        from: [114, 3802],
        serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)),
        parse: (x: string) => JSON.parse(x),
      },
    },
  });
  return {
    begin: (fn) =>
      sql.begin((t) =>
        fn(
          (text, params) => t.unsafe(text, (params ?? []) as never[]) as never,
          async (script) => {
            await t.unsafe(script);
          },
        ),
      ) as never,
  };
}

/** On Vercel the filesystem is read-only, so running without a database cannot work. */
function missingDatabaseStore(): Store {
  const fail = async (): Promise<never> => {
    console.error("No database configured. Set DATABASE_URL, or connect Supabase to this Vercel project so POSTGRES_URL is provided.");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The game server is not connected to its database yet.");
  };
  return { kind: "postgres", tx: fail, reset: fail };
}

const g = globalThis as unknown as { __bgStore?: Store };

export function getStore(): Store {
  if (g.__bgStore) return g.__bgStore;
  const url = databaseUrl();
  if (url) {
    g.__bgStore = createPostgresStore(postgresJsDriver(url), loadMigrations());
  } else if (process.env.VERCEL) {
    g.__bgStore = missingDatabaseStore();
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
