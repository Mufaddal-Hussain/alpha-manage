import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

// End-to-end tests create and delete their own users, so they only ever run against the TEST database:
// the app server and the test workers both get TEST_DATABASE_URL as their DATABASE_URL.
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL is not set; e2e tests only run against the test database (see .env.example)");
process.env.DATABASE_URL = testDb;
process.env.DATABASE_URL_UNPOOLED = testDb;

// Port 3100, not 3000: other local apps often hold 3000, and reusing one of them would test the wrong app.
const port = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

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
  projects: [
    // Desktop: every spec except the phone ones.
    { name: "chromium", testIgnore: /mobile.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // Phones (T087, T092): iPhone-sized viewports, touch, 3x pixels and the iPhone user agent. The engine is Chromium
    // unless PHONE_BROWSER=webkit is set (run `npx playwright install webkit` first), because WebKit is only installed
    // on request. 390 x 844 is the main size; 375 (iPhone SE/mini) and 430 (Plus/Pro Max) are spot checks.
    ...([375, 390, 430] as const).map((width) => ({
      name: `iphone-${width}`,
      testMatch: width === 390 ? /mobile.*\.spec\.ts/ : /mobile-audit\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        browserName: (process.env.PHONE_BROWSER === "webkit" ? "webkit" : "chromium") as "webkit" | "chromium",
        viewport: { width, height: width === 375 ? 667 : width === 430 ? 932 : 844 },
      },
    })),
  ],
  // Starts the dev server (on the test database) unless PLAYWRIGHT_BASE_URL points at one that is already running.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { DATABASE_URL: testDb, DATABASE_URL_UNPOOLED: testDb },
      },
});
