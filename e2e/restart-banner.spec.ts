import { expect, test } from "./fixtures";

// The status endpoint is faked: a real restart would wipe the emulator and is covered by restart.spec.ts.
test("restart banner without a baseline opens the settings dialog in place", async ({ page, target }) => {
  await page.route(/\/api\/targets\/[^/]+\/status$/, (route) =>
    route.fulfill({
      json: {
        canDetect: true,
        restartedAt: new Date(Date.now() - 47_000).toISOString(),
        bannerVisible: true,
        baseline: null,
        autoReplay: false,
        lastRun: null,
      },
    }),
  );
  await page.goto(target.base);
  const banner = page.getByTestId("restart-banner");
  await expect(banner).toContainText("Set a baseline fixture");
  await banner.getByRole("button", { name: "Choose a baseline" }).click();
  await expect(page.getByRole("dialog").getByLabel("Baseline fixture")).toBeVisible();
  expect(page.url()).toContain(target.base);
});
