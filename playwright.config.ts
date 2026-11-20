import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

// End-to-end tests create and delete their own users, so they only ever run against the TEST database:
// the app server and the test workers both get TEST_DATABASE_URL as their DATABASE_URL.
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL is not set; e2e tests only run against the test database (see .env.example)");
process.env.DATABASE_URL = testDb;
process.env.DATABASE_URL_UNPOOLED = testDb;

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Starts the dev server (on the test database) unless PLAYWRIGHT_BASE_URL points at one that is already running.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { DATABASE_URL: testDb, DATABASE_URL_UNPOOLED: testDb },
      },
});
