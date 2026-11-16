import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, expectToast, test, uniq } from "./fixtures";

// Restarting the emulator wipes its state, so this only runs against a throwaway compose project:
//   EMU_PORT=9298 CONSOLE_PORT=3100 EMU_STATE_DIR=<scratch> docker compose -p ec-restart-test up -d
//   E2E_COMPOSE_PROJECT=ec-restart-test E2E_BASE_URL=http://localhost:3100 (same env vars) npm run e2e -- restart
// `npm run e2e:restart` does all of this for you (scripts/e2e-stack.sh).
const project = process.env.E2E_COMPOSE_PROJECT;
test.skip(!project, "needs E2E_COMPOSE_PROJECT: a throwaway stack whose emulator may be restarted");

const restartEmulator = () =>
  execSync(`docker compose -p ${project} restart emulator`, { cwd: resolve(process.cwd()), stdio: "pipe" });

test("restart is detected; the baseline is replayed automatically, or on demand", async ({ page, target, call }) => {
  test.setTimeout(240_000);
  const bucket = uniq("e2e-base");
  const fixtureName = uniq("e2e-baseline");

  // a baseline fixture that rebuilds one bucket
  const created = await page.request.post("/api/fixtures", {
    data: { name: fixtureName, steps: [{ service: "s3", operation: "CreateBucket", input: { Bucket: bucket } }] },
  });
  expect(created.ok()).toBe(true);
  await call("s3", "CreateBucket", { Bucket: bucket });

  const configure = async (auto: boolean) => {
    await page.goto(target.base);
    await page.getByRole("button", { name: "Restart recovery settings" }).click();
    await page.getByLabel("Baseline fixture").selectOption({ label: fixtureName });
    const sw = page.getByRole("switch", { name: "Replay automatically after a restart" });
    // wait until the dialog shows what is saved before flipping it (it loads asynchronously)
    await expect(sw).toBeEnabled();
    await expect(sw).toHaveAttribute("aria-checked", String(!auto));
    await sw.click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Settings saved");
  };

  try {
    // ---- automatic replay
    await configure(true);
    await expect(page.getByTestId("restart-banner")).toHaveCount(0); // nothing has restarted yet
    await call("s3", "HeadBucket", { Bucket: bucket });

    restartEmulator();
    await expect(call("s3", "HeadBucket", { Bucket: bucket })).rejects.toThrow(); // state really is gone (or the emulator is down)

    await expect(page.getByTestId("restart-banner")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("restart-banner")).toContainText("state restored", { timeout: 90_000 });
    await call("s3", "HeadBucket", { Bucket: bucket }); // rebuilt by the baseline, with nobody clicking anything
    await page.getByTestId("restart-banner").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("restart-banner")).toHaveCount(0);

    // the run is in the fixture's history, marked as triggered by the restart
    await page.goto(`/fixtures`);
    await page.getByRole("link", { name: fixtureName }).click();
    await expect(page.getByText("after restart")).toBeVisible();

    // ---- manual replay
    await configure(false);
    restartEmulator();
    const banner = page.getByTestId("restart-banner");
    await expect(banner).toContainText("Its state was reset", { timeout: 60_000 });
    await expect(banner.getByRole("button", { name: new RegExp(`Replay “${fixtureName}”`) })).toBeVisible();
    await expect
      .poll(async () =>
        call("s3", "HeadBucket", { Bucket: bucket }).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false); // not replayed by itself
    await banner.getByRole("button", { name: /Replay/ }).click();
    await expectToast(page, `Baseline “${fixtureName}” replayed`);
    await expect(page.getByTestId("restart-banner")).toHaveCount(0);
    await call("s3", "HeadBucket", { Bucket: bucket });
  } finally {
    await call("s3", "DeleteBucket", { Bucket: bucket }).catch(() => {});
    for (const f of (await (await page.request.get("/api/fixtures")).json()).filter(
      (f: any) => f.name === fixtureName,
    )) {
      await page.request.delete(`/api/fixtures/${f.id}`);
    }
  }
});
