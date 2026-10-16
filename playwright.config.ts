import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the main player journeys, against a production build with the in-memory store.
 * CI runs Chromium, WebKit (Safari's engine) and a phone-sized Chromium; locally, set PW_CHANNEL=chrome
 * to use an installed Chrome. `npm run e2e`.
 */
const PORT = 3123;
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // A screen without a stored picture yet (e.g. a new browser) records one instead of failing.
  updateSnapshots: "missing",
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel } },
    { name: "phone", use: { ...devices["Pixel 7"], channel } },
    ...(process.env.CI || process.env.PW_WEBKIT ? [{ name: "webkit", use: { ...devices["iPhone 15"] } }] : []),
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/stats`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BG_DB_FILE: ":memory:" },
  },
});
