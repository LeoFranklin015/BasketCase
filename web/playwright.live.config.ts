import { defineConfig, devices } from "@playwright/test";

// Live end-to-end test against a running app on NEAR testnet (real transactions, test tokens).
// Usage: E2E_BASE_URL=http://127.0.0.1:3311 pnpm test:live
// The server needs RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY so the guest wallet gets gas.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /live\.spec\.ts$/,
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3311",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
});
