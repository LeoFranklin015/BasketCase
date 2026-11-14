import { defineConfig, devices } from "@playwright/test";

const PORT = 3123;

export default defineConfig({
  testDir: "./e2e",
  // live.spec.ts sends real testnet transactions; it has its own config (playwright.live.config.ts).
  testIgnore: /live(-mainnet)?\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Fixture mode: every page renders without deployed contracts.
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    env: { NEXT_PUBLIC_DATA: "fixture", NEXT_DIST_DIR: ".next-e2e" },
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
