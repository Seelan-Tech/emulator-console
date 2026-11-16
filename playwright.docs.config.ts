import { defineConfig } from "@playwright/test";

// Generates the screenshots used by the user guide (docs/images). Run it with `npm run docs:screenshots`, which
// starts a throwaway stack first (scripts/e2e-stack.sh).
export default defineConfig({
  testDir: "./e2e/docs",
  testMatch: /.*\.shots\.ts/,
  timeout: 300_000,
  expect: { timeout: 20_000 }, // the emulator can be slow on a cold start
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
  },
});
