import type { Page } from "@playwright/test";

import { expect, expectToast, test, uniq } from "./fixtures";

const setEditor = async (page: Page, text: string) => {
  const ed = page.locator(".cm-content").first();
  await ed.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
};

test("DynamoDB: create table, edit items losslessly, query, paginate, delete", async ({ page, target, call }) => {
  const name = uniq("e2e-ddb");
  await page.goto(`${target.base}/dynamodb`);

  // create (partition + numeric sort key)
  await page.getByRole("button", { name: "Create table" }).first().click();
  await page.getByLabel("Table name").fill(name);
  await page.getByLabel("Sort key (optional)").fill("n");
  await page.getByLabel("Type").nth(1).selectOption("N");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("ACTIVE")).toBeVisible({ timeout: 20_000 }); // polls out of CREATING

  try {
    await page.getByRole("link", { name: name }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("This table is empty")).toBeVisible();

    // new item with a string set, nested map and a high-precision number
    await page.getByRole("button", { name: "New item" }).click();
    await setEditor(
      page,
      JSON.stringify({
        id: "a",
        n: 1,
        tags: { $ss: ["x", "y"] },
        nested: { k: [1, 2] },
        big: { $n: "12345678901234567890123" },
      }),
    );
    await page.getByRole("button", { name: "Save item" }).click();
    await expectToast(page, "Item saved");
    await expect(page.getByRole("cell", { name: "a", exact: true })).toBeVisible();

    // the stored types are exact (set stays a set, big number stays a number)
    const got = await call("dynamodb", "GetItem", { TableName: name, Key: { id: { S: "a" }, n: { N: "1" } } });
    expect(got.Item.tags).toEqual({ SS: ["x", "y"] });
    expect(got.Item.big).toEqual({ N: "12345678901234567890123" });

    // edit through the UI and verify the set survived a round trip
    await page.getByRole("cell", { name: "a", exact: true }).click();
    await expect(page.locator(".cm-content").first()).toContainText("$ss");
    await setEditor(page, JSON.stringify({ id: "a", n: 1, tags: { $ss: ["x", "y"] }, edited: true }));
    await page.getByRole("button", { name: "Save item" }).click();
    await expectToast(page, "Item saved");
    const edited = await call("dynamodb", "GetItem", { TableName: name, Key: { id: { S: "a" }, n: { N: "1" } } });
    expect(edited.Item.edited).toEqual({ BOOL: true });
    expect(edited.Item.tags).toEqual({ SS: ["x", "y"] });

    // 30 more items, then paginate 10 at a time
    for (let start = 0; start < 30; start += 25) {
      const batch = Array.from({ length: Math.min(25, 30 - start) }, (_, i) => ({
        PutRequest: { Item: { id: { S: `p${start + i}` }, n: { N: String(start + i) } } },
      }));
      await call("dynamodb", "BatchWriteItem", { RequestItems: { [name]: batch } });
    }
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByLabel("Per page").selectOption("10");
    await expect(page.getByTestId("page-info")).toHaveText(/Items 1–10 · page 1/);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("page-info")).toHaveText(/Items 11–20 · page 2/);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("page-info")).toHaveText(/page 4/);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByTestId("page-info")).toHaveText(/page 3/);

    // key query
    await page.getByLabel("Mode").selectOption("query");
    await page.getByLabel("Partition key value").fill("p7");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByRole("cell", { name: "p7", exact: true })).toBeVisible();
    await expect(page.getByTestId("page-info")).toHaveText(/Items 1–1/);

    // delete the item "a" through the UI
    await page.getByLabel("Partition key value").fill("a");
    await page.getByRole("button", { name: "Run" }).click();
    await page.getByRole("button", { name: "Delete item" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Nothing matches that key")).toBeVisible();
  } finally {
    // typed-confirm table delete (also the assertion that it works)
    await page.goto(`${target.base}/dynamodb`);
    await page.getByRole("button", { name: `Delete table ${name}` }).click();
    await page.getByLabel("Confirmation").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name })).toHaveCount(0, { timeout: 20_000 });
  }
});
