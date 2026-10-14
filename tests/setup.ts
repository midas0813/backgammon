import { beforeEach } from "vitest";
import { invalidateSettings } from "@/lib/server/settings";
import { getStore, setStore } from "@/lib/server/store";

// BG_STORE=pglite runs the whole suite against Postgres (the Supabase schema) instead of memory.
if (process.env.BG_STORE === "pglite") {
  const { createPgliteStore } = await import("./pglite");
  setStore(await createPgliteStore());
}

beforeEach(async () => {
  await getStore().reset();
  invalidateSettings();
});
