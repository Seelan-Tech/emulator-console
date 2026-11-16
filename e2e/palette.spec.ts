import type { Page } from "@playwright/test";

import { deleteTableReliably, expect, test, uniq } from "./fixtures";

const open = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+K");
  await expect(page.getByTestId("palette")).toBeVisible();
};
const options = (page: Page) => page.getByTestId("palette").getByRole("option");

test("command palette: hotkey, fuzzy search over pages, resources and operations, keyboard navigation, recents, actions", async ({
  page,
  target,
  call,
}) => {
  const bucket = uniq("pal-bkt"),
    table = uniq("pal-tbl"),
    topic = uniq("pal-top");
  await call("s3", "CreateBucket", { Bucket: bucket });
  await call("dynamodb", "CreateTable", {
    TableName: table,
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  });
  const { TopicArn } = await call("sns", "CreateTopic", { Name: topic });
  await expect
    .poll(async () => (await call("dynamodb", "DescribeTable", { TableName: table })).Table.TableStatus, {
      timeout: 20_000,
    })
    .toBe("ACTIVE");
  try {
    await page.goto(target.base);

    // hotkey opens it, Escape closes it, and the header button opens it too
    await open(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toHaveCount(0);
    await page
      .getByRole("button", { name: /Search/ })
      .first()
      .click();
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("palette")).toHaveCount(0); // toggles

    // the empty state offers quick navigation only
    await open(page);
    await expect(options(page).filter({ hasText: "Overview" })).toBeVisible();
    await expect(page.getByTestId("palette").getByText("Operations", { exact: true })).toHaveCount(0);

    // fuzzy: "ddb" finds DynamoDB; Enter navigates
    await page.getByLabel("Search").fill("ddb");
    await expect(options(page).first()).toContainText("DynamoDB");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${target.base}/dynamodb$`));
    await expect(page.getByTestId("palette")).toHaveCount(0);

    // resources by name, from the target we're inside
    await open(page);
    await page.getByLabel("Search").fill(bucket);
    await expect(options(page).first()).toContainText(bucket);
    await expect(options(page).first()).toContainText("S3 bucket");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/s3/${bucket}$`));

    await open(page);
    await page.getByLabel("Search").fill(table);
    await options(page).first().click(); // mouse works too
    await expect(page).toHaveURL(new RegExp(`/dynamodb/${table}$`));

    await open(page);
    await page.getByLabel("Search").fill(topic);
    await expect(options(page).first()).toContainText("SNS topic");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/sns/${topic}$`));

    // any operation of any service, grouped separately
    await open(page);
    await page.getByLabel("Search").fill("ssm.PutPar");
    await expect(options(page).first()).toContainText("ssm.PutParameter");
    await expect(page.getByTestId("palette").getByText("Operations", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/s/ssm/PutParameter$`));

    // arrow keys move the selection (aria-selected follows), Enter opens the selected row
    await open(page);
    await page.getByLabel("Search").fill("s3");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    // recents: what we just visited is on top of the empty state
    await open(page);
    await expect(page.getByTestId("palette").getByText("Recent", { exact: true })).toBeVisible();
    await expect(options(page).first()).toContainText("ssm.PutParameter");
    await page.keyboard.press("Escape");

    // nothing matches
    await open(page);
    await page.getByLabel("Search").fill("qqqzzzxxx");
    await expect(page.getByText("Nothing matches")).toBeVisible();
    await page.keyboard.press("Escape");

    // actions: theme
    await open(page);
    await page.getByLabel("Search").fill("dark theme");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await open(page);
    await page.getByLabel("Search").fill("system theme");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // outside a target it still works: workspace pages offer targets and fixtures
    await page.goto(`/fixtures`);
    await open(page);
    await page.getByLabel("Search").fill("local emu");
    await expect(options(page).first()).toContainText("Local emulator");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${target.base}$`));
  } finally {
    await call("s3", "DeleteBucket", { Bucket: bucket }).catch(() => {});
    await deleteTableReliably(call, table);
    await call("sns", "DeleteTopic", { TopicArn }).catch(() => {});
  }
});
