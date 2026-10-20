import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. Locally this starts the River API on :3000, the identity host on :3001 and
// the UI on :5173. Set E2E_BASE_URL (and E2E_IDENTITY_URL) to run against servers started
// elsewhere, as CI does.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";
export const identityURL = process.env.E2E_IDENTITY_URL || "http://localhost:3001";

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
          command: "npm run build:identity-client && npm run dev:identity",
          url: "http://localhost:3001/health",
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
