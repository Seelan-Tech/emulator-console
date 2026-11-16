import type { Page } from "@playwright/test";

import { deleteTableReliably, expect, expectToast, test, uniq } from "./fixtures";

const rows = (page: Page) => page.getByRole("table").getByRole("row");
// no matches render an empty state instead of a table, so there are no rows at all
const dataRows = async (page: Page) => Math.max((await rows(page).count()) - 1, 0);
const run = (page: Page) => page.getByTestId("query-builder").getByRole("button", { name: "Run" }).click();
const addFilter = async (page: Page, i: number, attr: string, op: string, value?: string, type?: string) => {
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByLabel(`Filter ${i} attribute`).fill(attr);
  await page.getByLabel(`Filter ${i} operator`).selectOption(op);
  if (type) await page.getByLabel(`Filter ${i} type`).selectOption(type);
  if (value !== undefined) await page.getByLabel(`Filter ${i} value`).fill(value);
};

test("DynamoDB query builder: key conditions, indexes, filters, ordering, paging, request preview", async ({
  page,
  target,
  call,
}) => {
  test.setTimeout(120_000);
  const name = uniq("e2e-qb");
  await call("dynamodb", "CreateTable", {
    TableName: name,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "ts", AttributeType: "N" },
      { AttributeName: "status", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "ts", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "by-status",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "ts", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  });
  try {
    await expect
      .poll(async () => (await call("dynamodb", "DescribeTable", { TableName: name })).Table.TableStatus, {
        timeout: 20_000,
      })
      .toBe("ACTIVE");
    // user u1: ts 1..30 (open when ts % 3 == 0; Oslo for ts > 25); user u2: three closed items
    const put = (i: number) => ({
      PutRequest: {
        Item: {
          pk: { S: "u1" },
          ts: { N: String(i) },
          status: { S: i % 3 === 0 ? "open" : "closed" },
          label: { S: `item-${i}` },
          address: { M: { city: { S: i > 25 ? "Oslo" : "Rome" } } },
        },
      },
    });
    const other = (i: number) => ({
      PutRequest: {
        Item: { pk: { S: "u2" }, ts: { N: String(i) }, status: { S: "closed" }, label: { S: `other-${i}` } },
      },
    });
    const all = [...Array.from({ length: 30 }, (_, k) => put(k + 1)), ...[1, 2, 3].map(other)];
    for (let i = 0; i < all.length; i += 25)
      await call("dynamodb", "BatchWriteItem", { RequestItems: { [name]: all.slice(i, i + 25) } });

    await page.goto(`${target.base}/dynamodb/${name}`);
    await expect(page.getByTestId("query-builder")).toBeVisible();
    await expect(rows(page).nth(1)).toBeVisible();

    // the request preview mirrors the form, and the same request is available as an AWS CLI command
    await page.getByRole("button", { name: "Show request" }).click();
    await expect(page.getByTestId("request-preview")).toContainText('"operation": "Scan"');
    await page.getByLabel("Mode").selectOption("query");
    await expect(page.getByTestId("request-preview")).toContainText("Enter a value for the partition key");
    await page.getByLabel("Partition key value").fill("u1");
    await expect(page.getByTestId("request-preview")).toContainText('"KeyConditionExpression": "#h = :h"');
    await expect(page.getByTestId("cli")).toContainText("aws dynamodb query");

    // validation happens before anything is sent
    await page.getByLabel("Partition key value").fill("");
    await run(page);
    await expectToast(page, "Enter a value for the partition key");
    await page.getByLabel("Partition key value").fill("u1");

    // sort key: between (typed as numbers), then the other operators
    await page.getByLabel("Sort key operator").selectOption("between");
    await page.getByLabel("Sort key value").fill("5");
    await page.getByLabel("Sort key upper bound").fill("8");
    await run(page);
    await expect(page.getByTestId("page-info")).toHaveText(/Items 1–4 · page 1/);
    expect(await dataRows(page)).toBe(4);
    await page.getByLabel("Sort key operator").selectOption(">=");
    await page.getByLabel("Sort key value").fill("28");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(3); // 28, 29, 30
    await page.getByLabel("Sort key value").fill("abc");
    await run(page);
    await expectToast(page, "enter a number");

    // descending order
    await page.getByLabel("Sort key operator").selectOption("=");
    await page.getByLabel("Sort key value").fill("");
    await page.getByLabel("Descending order").click();
    await run(page);
    await expect(rows(page).nth(1)).toContainText("item-30");
    await page.getByLabel("Descending order").click();

    // filters: AND, OR, nested path (address.city), begins_with.
    // DynamoDB applies the page size BEFORE the filter, so a large page evaluates every item at once.
    await page.getByLabel("Per page").selectOption("100");

    await addFilter(page, 1, "status", "=", "open");
    await addFilter(page, 2, "address.city", "=", "Oslo");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(2); // ts 27 and 30
    await page.getByLabel("Combine filters").selectOption("OR");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(13); // 10 open ∪ 5 in Oslo, 2 in both
    await page.getByRole("button", { name: "Remove filter 2" }).click();
    await page.getByLabel("Filter 1 operator").selectOption("begins_with");
    await page.getByLabel("Filter 1 attribute").fill("label");
    await page.getByLabel("Filter 1 value").fill("item-2");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(11); // item-2, item-20…item-29

    // a filter on a key attribute is explained, not sent
    await page.getByLabel("Filter 1 attribute").fill("pk");
    await run(page);
    await expectToast(page, "is a key attribute");

    // existence checks and a number-typed filter
    await page.getByLabel("Filter 1 attribute").fill("address");
    await page.getByLabel("Filter 1 operator").selectOption("not_exists");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(0);
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.getByLabel("Filter 1 operator").selectOption("exists");
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(30); // every u1 item has an address
    await page.getByRole("button", { name: "Remove filter 1" }).click();

    // global secondary index: its own key schema, descending, and no consistent reads
    await page.getByLabel("Index").selectOption("by-status");
    await expect(page.getByLabel("Partition key value")).toHaveAttribute("placeholder", /status/);
    await expect(page.getByLabel("Consistent read")).toBeDisabled();
    await page.getByLabel("Partition key value").fill("open");
    await page.getByLabel("Descending order").click();
    await run(page);
    await expect.poll(() => dataRows(page)).toBe(10);
    await expect(rows(page).nth(1)).toContainText("item-30");
    await page.getByLabel("Descending order").click();

    // back on the table: a scan with a filter pages through uneven pages and reports accurate ranges
    await page.getByLabel("Index").selectOption("");
    await expect(page.getByLabel("Consistent read")).toBeEnabled();
    await page.getByLabel("Mode").selectOption("scan");
    await addFilter(page, 1, "label", "begins_with", "item-1");
    await page.getByLabel("Per page").selectOption("10");
    // wait for each Scan response and for the loading skeletons to go before reading the page
    const settled = async (action: () => Promise<unknown>) => {
      await Promise.all([page.waitForResponse((r) => /\/dynamodb\/(Scan|Query)/.test(r.url())), action()]);
      await expect(page.locator(".animate-pulse")).toHaveCount(0);
    };
    await settled(() => run(page));
    let total = 0;
    const pageSizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const n = await dataRows(page);
      pageSizes.push(n);
      total += n;
      // the range shown always matches what has been seen so far
      if (n)
        await expect(page.getByTestId("page-info")).toHaveText(
          new RegExp(`Items ${total - n + 1}–${total} · page ${guard + 1}`),
        );
      const next = page.getByRole("button", { name: "Next" });
      if (await next.isDisabled()) break;
      await settled(() => next.click());
    }
    expect(pageSizes.length).toBeGreaterThan(1); // it really did page
    expect(total).toBe(11); // item-1, item-10…item-19

    // reset restores a clean scan
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Mode")).toHaveValue("scan");
    await expect(page.getByLabel("Filter 1 attribute")).toHaveCount(0);
  } finally {
    await deleteTableReliably(call, name);
  }
});
