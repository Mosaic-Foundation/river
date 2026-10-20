import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. Locally (and in CI) this starts the API on :3000 and the UI on :5173.
// Set E2E_BASE_URL to run against a deployed URL instead.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run dev",
          url: "http://localhost:3000/health",
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: "npm run dev --prefix ui",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
