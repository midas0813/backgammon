import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    env: { BG_DB_FILE: ":memory:" },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    // Creating the PGlite database and applying migrations can exceed the 10 s default on a busy machine.
    hookTimeout: 60000,
    maxWorkers: 2,
  },
});
