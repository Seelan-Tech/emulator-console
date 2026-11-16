import type { Page } from "@playwright/test";

import { makeZip } from "../../src/features/lambda/zip";
import { deleteTableReliably, expect, test } from "../fixtures";

// Seeds a small, realistic set of resources and photographs the main screens in both themes. The images are
// committed (docs/images) so the guide renders on GitHub; rerun this when the UI changes.
const OUT = "docs/images";
const THEMES = ["light", "dark"] as const;

test("user guide screenshots", async ({ page, target, call }) => {
  const { base } = target;
  const bucket = "demo-assets";
  const table = "demo-orders";
  const queue = "demo-jobs";
  const dlq = "demo-jobs-dlq";
  const topic = "demo-events";
  const fn = "demo-hello";
  const secret = "app/db-password";

  // ---- seed (through the API, so nothing lands in the recorder)
  await call("s3", "CreateBucket", { Bucket: bucket });
  for (const [key, body, type] of [
    ["README.txt", "Static assets for the demo app.\n", "text/plain"],
    ["config.json", JSON.stringify({ env: "dev", features: { search: true } }, null, 2), "application/json"],
    [
      "images/logo.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#4f46e5"/></svg>',
      "image/svg+xml",
    ],
    ["images/banner.txt", "banner", "text/plain"],
    ["reports/2026-01.csv", "id,total\n1,19.99\n2,5.00\n", "text/csv"],
  ] as const)
    await call("s3", "PutObject", {
      Bucket: bucket,
      Key: key,
      Body: { $base64: Buffer.from(body).toString("base64") },
      ContentType: type,
    });

  await call("dynamodb", "CreateTable", {
    TableName: table,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "customer", AttributeType: "S" },
      { AttributeName: "orderedAt", AttributeType: "N" },
      { AttributeName: "status", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "customer", KeyType: "HASH" },
      { AttributeName: "orderedAt", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "by-status",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "orderedAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });
  await expect
    .poll(async () => (await call("dynamodb", "DescribeTable", { TableName: table })).Table.TableStatus, {
      timeout: 30_000,
    })
    .toBe("ACTIVE");
  const customers = ["ada", "grace", "linus"];
  const statuses = ["open", "shipped", "cancelled"];
  await call("dynamodb", "BatchWriteItem", {
    RequestItems: {
      [table]: Array.from({ length: 12 }, (_, i) => ({
        PutRequest: {
          Item: {
            customer: { S: customers[i % 3] },
            orderedAt: { N: String(1760000000 + i * 3600) },
            status: { S: statuses[i % 3] },
            total: { N: String(10 + i * 4.5) },
            items: { L: [{ S: "keyboard" }, { S: "mouse" }] },
          },
        },
      })),
    },
  });

  const dlqUrl = (await call("sqs", "CreateQueue", { QueueName: dlq })).QueueUrl as string;
  const queueUrl = (await call("sqs", "CreateQueue", { QueueName: queue })).QueueUrl as string;
  for (let i = 1; i <= 4; i++)
    await call("sqs", "SendMessage", {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ job: "resize", image: `img-${i}.png` }),
    });
  void dlqUrl;

  const topicArn = (await call("sns", "CreateTopic", { Name: topic })).TopicArn as string;
  void topicArn;

  await call("secretsmanager", "CreateSecret", {
    Name: secret,
    SecretString: "s3cr3t-demo-value",
    Description: "Database password for the demo app",
  });

  // a Lambda function, through the UI (it fills in the role and starter code)
  await page.goto(`${base}/lambda`);
  await page.getByRole("button", { name: "Create function" }).first().click();
  await page.getByLabel("Function name").fill(fn);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("row", { name: new RegExp(fn) }).getByText("Active")).toBeVisible({ timeout: 60_000 });
  void makeZip;

  const shot = async (p: Page, name: string, theme: (typeof THEMES)[number]) =>
    p.screenshot({ path: `${OUT}/${name}${theme === "dark" ? "-dark" : ""}.png` });
  const settle = async (p: Page) => {
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(400);
  };

  // ---- the recorder: do two real actions in the UI so the drawer has something to show
  await page.goto(`${base}/sqs`);
  await page.getByRole("button", { name: "Create queue" }).first().click();
  await page.getByLabel("Queue name").fill("demo-emails");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: "demo-emails" })).toBeVisible();
  await page.goto(`${base}/sns`);
  await page.getByRole("button", { name: "Create topic" }).first().click();
  await page.getByLabel("Topic name").fill("demo-alerts");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: "demo-alerts" })).toBeVisible();

  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });

    await page.goto(`/`);
    await settle(page);
    await shot(page, "targets", theme);

    await page.goto(base);
    await settle(page);
    await page.waitForTimeout(3000); // the service probes finish a moment after the page loads
    await shot(page, "overview", theme);

    await page.goto(`${base}/s3`);
    await settle(page);
    await shot(page, "s3-buckets", theme);
    await page.goto(`${base}/s3/${bucket}`);
    await settle(page);
    await shot(page, "s3-objects", theme);

    await page.goto(`${base}/dynamodb`);
    await settle(page);
    await shot(page, "dynamodb-tables", theme);
    await page.goto(`${base}/dynamodb/${table}`);
    await settle(page);
    await shot(page, "dynamodb-items", theme);
    await page.getByLabel("Mode").selectOption("query");
    await page.getByLabel("Partition key value").fill("ada");
    await page.getByRole("button", { name: /Add filter/ }).click();
    await page.getByLabel("Filter 1 attribute").fill("status");
    await page.getByLabel("Filter 1 value").fill("open");
    await page.getByRole("button", { name: /Show request/ }).click();
    await page.getByRole("button", { name: /Run/ }).click();
    await settle(page);
    await shot(page, "dynamodb-query", theme);

    await page.goto(`${base}/sqs`);
    await settle(page);
    await shot(page, "sqs-queues", theme);
    await page.goto(`${base}/sqs/${queue}`);
    await settle(page);
    await shot(page, "sqs-queue", theme);

    await page.goto(`${base}/lambda`);
    await settle(page);
    await shot(page, "lambda-functions", theme);
    await page.goto(`${base}/lambda/${fn}`);
    await expect(page.getByTestId("fn-state")).toHaveText("Active", { timeout: 45_000 });
    await settle(page);
    await shot(page, "lambda-function", theme);

    await page.goto(`${base}/sns`);
    await settle(page);
    await shot(page, "sns-topics", theme);
    await page.goto(`${base}/sns/${topic}`);
    await settle(page);
    await shot(page, "sns-topic", theme);

    await page.goto(`${base}/secrets`);
    await settle(page);
    await shot(page, "secrets", theme);
    await page.getByRole("link", { name: secret }).click();
    await settle(page);
    await shot(page, "secret-detail", theme);

    await page.goto(`${base}/s/ssm`);
    await settle(page);
    await shot(page, "operations", theme);
    await page.goto(`${base}/s/sqs/CreateQueue`);
    await settle(page);
    await shot(page, "operation-form", theme);

    // command palette
    await page.goto(`${base}/s3`);
    await settle(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Search" }).fill("demo");
    await page.waitForTimeout(800);
    await shot(page, "palette", theme);
    await page.keyboard.press("Escape");

    // recorder
    await page.goto(`${base}/sns`);
    await settle(page);
    await page.getByRole("button", { name: /Steps/ }).click();
    await shot(page, "recorder", theme);
    await page.getByRole("button", { name: "Save as fixture" }).click();
    await page.getByPlaceholder("Fixture name").fill("demo-setup");
    await shot(page, "recorder-save", theme);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // restart banner: the status endpoint is faked, because a real restart would wipe the emulator
    await page.route(/\/api\/targets\/[^/]+\/status$/, (route) =>
      route.fulfill({
        json: {
          canDetect: true,
          restartedAt: new Date(Date.now() - 20_000).toISOString(),
          bannerVisible: true,
          baseline: { id: "x", name: "demo-setup" },
          autoReplay: false,
          lastRun: null,
        },
      }),
    );
    await page.goto(base);
    await expect(page.getByTestId("restart-banner")).toBeVisible();
    await page.waitForTimeout(3000);
    await shot(page, "restart-banner", theme);
    await page.unroute(/\/api\/targets\/[^/]+\/status$/);
  }

  // fixtures and activity are only meaningful once a fixture exists (saved in the recorder step above, light theme)
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${base}/sns`);
  await page
    .getByRole("button", { name: /Steps/ })
    .click()
    .catch(() => {});
  await page.getByRole("button", { name: "Save as fixture" }).click();
  await page.getByPlaceholder("Fixture name").fill("demo-setup");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /Saved fixture/ })
      .first(),
  ).toBeVisible();
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/fixtures`);
    await settle(page);
    await shot(page, "fixtures", theme);
    await page.getByRole("link", { name: "demo-setup" }).click();
    await settle(page);
    await shot(page, "fixture-editor", theme);
    await page.goto(`/activity`);
    await settle(page);
    await shot(page, "activity", theme);
  }

  // leave the stack tidy in case someone runs this against a live one
  await deleteTableReliably(call, table);
});
