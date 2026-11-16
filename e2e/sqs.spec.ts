import type { Page } from "@playwright/test";

import { expect, expectToast, test, uniq } from "./fixtures";

const typeInEditor = async (page: Page, text: string) => {
  // Bounded, so a page that never loaded fails fast and the test's own cleanup still has time to run.
  await page.locator(".cm-content").first().click({ timeout: 20_000 });
  await page.keyboard.insertText(text);
};

test("SQS: standard queue send, peek vs receive, delete, purge, typed-confirm delete", async ({
  page,
  target,
  call,
}) => {
  const name = uniq("e2e-q");
  await page.goto(`${target.base}/sqs`);
  await page.getByRole("button", { name: "Create queue" }).first().click();
  await page.getByLabel("Queue name").fill("bad name");
  await expect(page.getByText(/Letters, digits/)).toBeVisible();
  await page.getByLabel("Queue name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();

  try {
    await page.getByRole("link", { name }).click();
    await expect(page.getByTestId("count-available")).toHaveText("0");

    // send a JSON message with an attribute
    await typeInEditor(page, '{"order":42}');
    await page.getByRole("button", { name: "Add attribute" }).click();
    await page.getByLabel("Attribute 1 name").fill("source");
    await page.getByLabel("Attribute 1 value").fill("e2e");
    await page.getByRole("button", { name: "Send message" }).click();
    await expectToast(page, /^Sent /);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("count-available")).toHaveText("1");

    // peek twice: the same message both times, and it stays available
    await page.getByRole("tab", { name: "Receive" }).click();
    await page.getByRole("button", { name: "Poll" }).click();
    await expect(page.getByTestId("message-body")).toContainText('"order": 42');
    await expect(page.getByText("source = e2e")).toBeVisible();
    await page.getByRole("button", { name: "Poll" }).click();
    await expect(page.getByTestId("message-body")).toHaveCount(1);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("count-available")).toHaveText("1");

    // real receive hides it (in flight), then delete removes it for good
    await page.getByLabel("Peek").click();
    await page.getByRole("button", { name: "Poll" }).click();
    await expect(page.getByTestId("message-body")).toHaveCount(1);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("count-in-flight")).toHaveText("1");
    await page.getByRole("button", { name: "Delete message" }).click();
    await expect(page.getByText("No messages available")).toBeVisible();

    // purge
    await call("sqs", "SendMessage", {
      QueueUrl: (await call("sqs", "GetQueueUrl", { QueueName: name })).QueueUrl,
      MessageBody: "x",
    });
    await page.getByRole("button", { name: "Purge" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Purge" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("count-available")).toHaveText("0");
  } finally {
    await page.goto(`${target.base}/sqs`);
    await page.getByRole("button", { name: `Delete queue ${name}` }).click();
    await page.getByLabel("Confirmation").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
});

test("SQS: FIFO queues get the .fifo suffix and require a group id", async ({ page, target, call }) => {
  const base = uniq("e2e-f");
  await page.goto(`${target.base}/sqs`);
  await page.getByRole("button", { name: "Create queue" }).first().click();
  await page.getByLabel("Queue name").fill(base);
  await page.getByRole("switch", { name: "FIFO" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  const name = `${base}.fifo`;
  await expect(page.getByRole("link", { name })).toBeVisible();
  try {
    // A client-side link click can be swallowed while the list refetches; the queue page itself is what we test.
    await page.goto(`${target.base}/sqs/${name}`);
    await typeInEditor(page, "ordered");
    await page.getByRole("button", { name: "Send message" }).click();
    await expectToast(page, "needs a message group id");
    await page.getByLabel("Message group id").fill("g1");
    await page.getByRole("button", { name: "Send message" }).click();
    await expectToast(page, /^Sent /);
  } finally {
    const { QueueUrl } = await call("sqs", "GetQueueUrl", { QueueName: name });
    await call("sqs", "DeleteQueue", { QueueUrl });
  }
});
