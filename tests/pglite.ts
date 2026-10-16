import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStore, type Driver, type Migration } from "@/lib/server/store/postgres";

export function migrationFiles(): Migration[] {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

export function pgliteDriver(db: PGlite): Driver {
  return {
    begin: (fn) =>
      db.transaction((t) =>
        fn(
          async (text, params) => (await t.query(text, params as unknown[])).rows as never,
          async (script) => {
            await t.exec(script);
          },
        ),
      ),
    reset: async () => {
      const tables = (
        await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'app_schema_migrations'`)
      ).rows;
      await db.exec(`truncate ${tables.map((r) => r.tablename).join(", ")} restart identity cascade`);
    },
  };
}

/** A real Postgres (WASM). The store applies the same Supabase migrations the deployed app runs. */
export async function createPgliteStore() {
  return createPostgresStore(pgliteDriver(new PGlite()), migrationFiles());
}
