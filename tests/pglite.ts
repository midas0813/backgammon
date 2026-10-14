import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStore, type Driver } from "@/lib/server/store/postgres";

/** A real Postgres (WASM) loaded with the same Supabase migrations the app deploys. */
export async function createPgliteStore() {
  const db = new PGlite();
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  const tables = (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
  const driver: Driver = {
    begin: (fn) => db.transaction((t) => fn(async (text, params) => (await t.query(text, params as unknown[])).rows as never)),
    reset: async () => {
      await db.exec(`truncate ${tables.join(", ")} restart identity cascade`);
    },
  };
  return createPostgresStore(driver);
}
