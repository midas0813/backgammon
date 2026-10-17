import { beforeEach } from "vitest";
import { invalidateSettings } from "@/lib/server/settings";
import { getStore, setStore } from "@/lib/server/store";

// BG_STORE=pglite runs the whole suite against Postgres (the Supabase schema) instead of memory.
if (process.env.BG_STORE === "pglite") {
  const { createPgliteStore } = await import("./pglite");
  setStore(await createPgliteStore());
}

// BG_STORE=postgres runs it against a real Postgres server through the production driver (CI).
if (process.env.BG_STORE === "postgres") {
  const { createRealPgStore } = await import("./pgreal");
  setStore(createRealPgStore(process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres"));
}

beforeEach(async () => {
  await getStore().reset();
  invalidateSettings();
});
