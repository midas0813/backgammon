import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { databaseUrl } from "@/lib/server/store";
import { runMigrations } from "@/lib/server/store/postgres";
import { migrationFiles, pgliteDriver } from "./pglite";

describe("database configuration", () => {
  it("prefers DATABASE_URL, then Vercel's POSTGRES_URL, and strips provider-only parameters", () => {
    expect(databaseUrl({})).toBeNull();
    expect(databaseUrl({ DATABASE_URL: "postgresql://u:p@db:6543/postgres", POSTGRES_URL: "postgresql://x@y/z" })).toBe("postgresql://u:p@db:6543/postgres");
    expect(databaseUrl({ POSTGRES_URL: "postgres://postgres.ref:pw@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x" })).toBe(
      "postgres://postgres.ref:pw@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(databaseUrl({ POSTGRES_PRISMA_URL: "postgres://a:b@h:6543/postgres?pgbouncer=true&connect_timeout=15" })).toBe("postgres://a:b@h:6543/postgres");
    expect(databaseUrl({ POSTGRES_HOST: "db.ref.supabase.co", POSTGRES_PASSWORD: "p@ss/word", POSTGRES_USER: "postgres" })).toBe(
      "postgresql://postgres:p%40ss%2Fword@db.ref.supabase.co:6543/postgres",
    );
  });
});

describe("automatic schema setup", () => {
  it("creates every table on an empty database once, and is a no-op afterwards", async () => {
    const db = new PGlite();
    const driver = pgliteDriver(db);
    const first = await runMigrations(driver, migrationFiles());
    expect(first).toEqual(migrationFiles().map((m) => m.name));
    expect(await runMigrations(driver, migrationFiles())).toEqual([]);
    const tables = (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map(
      (r) => r.tablename,
    );
    for (const t of ["app_users", "app_sessions", "matches", "ledger_accounts", "ledger_entries", "match_presence", "disputes"]) expect(tables).toContain(t);
    // Every table is locked down for Supabase's public API keys.
    const open = (
      await db.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    ).rows;
    expect(open).toEqual([]);
  });

  it("is safe to re-run SQL that the Supabase GitHub integration may already have applied", async () => {
    const db = new PGlite();
    for (const m of migrationFiles()) await db.exec(m.sql); // applied outside our tracker
    expect(await runMigrations(pgliteDriver(db), migrationFiles())).toHaveLength(migrationFiles().length);
  });
});
