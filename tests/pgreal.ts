import { loadMigrations, postgresJsDriver } from "@/lib/server/store";
import { createPostgresStore, type Driver } from "@/lib/server/store/postgres";

/**
 * The production driver (postgres.js) against a real Postgres server (CI service container), so
 * driver-specific behaviour — how parameters are sent — is tested exactly as in production.
 */
export function createRealPgStore(url: string) {
  const base = postgresJsDriver(url);
  const driver: Driver = {
    begin: base.begin,
    reset: () =>
      base.begin(async (q) => {
        const tables = await q<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'app_schema_migrations'`);
        await q(`truncate ${tables.map((r) => r.tablename).join(", ")} restart identity cascade`);
      }),
  };
  return createPostgresStore(driver, loadMigrations());
}
