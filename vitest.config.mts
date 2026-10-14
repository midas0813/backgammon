import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    env: { BG_DB_FILE: ":memory:" },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
  },
});
