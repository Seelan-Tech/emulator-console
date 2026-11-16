import { expect, test } from "./fixtures";

test("the console opens on the Targets page with a ready target", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Local emulator" })).toBeVisible();
});

test("requests with a foreign Host header are refused", async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { host: "evil.example.com" } });
  expect((await ctx.get("/")).status()).toBe(403);
  expect((await ctx.get("/api/targets")).status()).toBe(403);
  await ctx.dispose();
});

test("target overview shows the connection and every service as available", async ({ page, target }) => {
  await page.goto(target.base);
  await expect(page.getByTestId("connection")).toHaveText("connected");
  await expect(page.getByTestId("emulator-version")).toHaveText(/^Emulator \d+\.\d+\.\d+/);
  for (const svc of ["s3", "dynamodb", "sqs", "sns", "lambda", "secretsmanager"]) {
    await expect(page.getByTestId(`svc-${svc}`).getByText("available")).toBeVisible();
  }
  await expect(page.getByTestId("recorder-count")).toHaveText("0 steps");
});

test("the targets page shows which emulator build each local target runs", async ({ page }) => {
  await page.goto(`/`);
  await expect(page.getByTestId("emulator-version")).toHaveText(/^Emulator \d+\.\d+\.\d+/);
});

test("a deep link opens directly", async ({ page, target }) => {
  await page.goto(`${target.base}/s3`);
  await expect(page).toHaveURL(new RegExp(`${target.base}/s3$`));
  await expect(page.getByRole("heading", { name: "S3 buckets" })).toBeVisible();
});

test("region choice is remembered per target", async ({ page, target }) => {
  await page.goto(target.base);
  await page.getByLabel("Region").selectOption("eu-west-1");
  await page.reload();
  await expect(page.getByLabel("Region")).toHaveValue("eu-west-1");
  await page.getByLabel("Region").selectOption("us-east-1");
});
