import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps jsx: "preserve" for Next; the test transform needs the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // Three kinds of tests, run separately: `npm test` (unit + components) and `npm run test:int` (a temporary SQLite file).
    projects: [
      {
        extends: true,
        test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/setup/dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.int.test.ts"],
          setupFiles: ["./tests/setup/integration.ts"],
          fileParallelism: false, // one shared database file
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "json-summary"],
      include: ["src/lib/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/components/**/*.tsx"],
      exclude: ["**/*.test.{ts,tsx}", "src/components/ui/**", "src/lib/api-types.ts"],
      // Floors, not goals: the screens are exercised by the Playwright suite, which this report does not see.
      // The logic in lib/ is held higher; DB-backed code there is additionally covered by the integration project.
      thresholds: {
        statements: 45,
        branches: 40,
        functions: 40,
        lines: 45,
        "src/lib/**": { statements: 70, branches: 65, functions: 70, lines: 70 },
      },
    },
  },
});
