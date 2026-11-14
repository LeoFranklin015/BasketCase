// Live check of the mainnet X card hand-off (no money moves): E2E_BASE_URL=<mainnet app> pnpm exec playwright test -c playwright.live-mainnet.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /live-mainnet\.spec\.ts$/,
  timeout: 90_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "https://basketcase-near.vercel.app", ...devices["Desktop Chrome"] },
});
