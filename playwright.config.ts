import { defineConfig } from "@playwright/test";

// E2E_MODE picks the suite: `local` (default: everything except the restart spec) or `restart` (restarts the
// stack's own emulator).
// `scripts/e2e-stack.sh run <mode>` starts a throwaway stack and sets all of these; `npm run e2e:live` runs the
// local suite against whatever is already listening on E2E_BASE_URL (default http://localhost:3000).
const mode = process.env.E2E_MODE ?? "local";
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: mode === "local" ? /.*\.spec\.ts/ : /restart\.spec\.ts/,
  testIgnore: mode === "local" ? [/restart\.spec\.ts/] : undefined,
  timeout: ci ? 120_000 : 60_000, // shared CI runners are slower, mostly the emulator's first requests
  expect: { timeout: ci ? 30_000 : 10_000 },
  fullyParallel: false, // one shared emulator with in-memory state
  workers: 1,
  retries: ci ? 2 : 0,
  forbidOnly: ci,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalTeardown: mode === "local" ? "./e2e/global-teardown.ts" : undefined,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "chrome", // the installed Chrome: no browser download needed
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
