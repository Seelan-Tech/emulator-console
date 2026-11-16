import type { Page } from "@playwright/test";

import { expect, expectToast, test, uniq } from "./fixtures";

const typeInEditor = async (page: Page, text: string) => {
  await page.locator(".cm-content").first().click();
  await page.keyboard.insertText(text);
};

test("SNS: topic, subscribe a queue (policy added), publish is delivered, unsubscribe, delete", async ({
  page,
  target,
  call,
}) => {
  const topic = uniq("e2e-topic");
  const queue = uniq("e2e-subq");
  const { QueueUrl } = await call("sqs", "CreateQueue", { QueueName: queue });
  const { Attributes } = await call("sqs", "GetQueueAttributes", { QueueUrl, AttributeNames: ["QueueArn"] });
  try {
    await page.goto(`${target.base}/sns`);
    await page.getByRole("button", { name: "Create topic" }).first().click();
    await page.getByLabel("Topic name").fill(topic);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: topic }).click();

    // subscribe the queue; the policy that lets SNS deliver is added for us
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await page.getByLabel("Endpoint").fill(Attributes.QueueArn);
    await page.getByRole("dialog").getByRole("button", { name: "Subscribe" }).click();
    await expectToast(page, "Subscribed");
    await expect(page.getByRole("cell", { name: Attributes.QueueArn, exact: true })).toBeVisible();
    await expect(page.getByText("confirmed", { exact: true })).toBeVisible();

    // an email subscription stays pending
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await page.getByLabel("Protocol").selectOption("email");
    await page.getByLabel("Endpoint").fill("someone@example.com");
    await page.getByRole("dialog").getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByText("pending confirmation")).toBeVisible();

    // publish with a subject and an attribute; the queue receives it
    await page.getByRole("tab", { name: "Publish" }).click();
    await typeInEditor(page, "hello subscribers");
    await page.getByLabel("Subject (optional)").fill("greeting");
    await page.getByRole("button", { name: "Add attribute" }).click();
    await page.getByLabel("Attribute 1 name").fill("k");
    await page.getByLabel("Attribute 1 value").fill("v");
    await page.getByRole("button", { name: "Publish" }).click();
    await expectToast(page, /^Published /);
    await expect
      .poll(
        async () => {
          const r = await call("sqs", "ReceiveMessage", { QueueUrl, WaitTimeSeconds: 0, VisibilityTimeout: 0 });
          return r.Messages?.length ? JSON.parse(r.Messages[0].Body) : null;
        },
        { timeout: 15_000 },
      )
      .toMatchObject({
        Type: "Notification",
        Subject: "greeting",
        Message: "hello subscribers",
        MessageAttributes: { k: { Type: "String", Value: "v" } },
      });

    // unsubscribe the queue
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await page.getByRole("button", { name: `Unsubscribe ${Attributes.QueueArn}` }).click();
    await expect(page.getByRole("cell", { name: Attributes.QueueArn, exact: true })).toHaveCount(0);

    // typed-confirm delete
    await page.goto(`${target.base}/sns`);
    await page.getByRole("button", { name: `Delete topic ${topic}` }).click();
    await page.getByLabel("Confirmation").fill(topic);
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name: topic })).toHaveCount(0);
  } finally {
    await call("sqs", "DeleteQueue", { QueueUrl }).catch(() => {});
    const { Topics } = await call("sns", "ListTopics");
    for (const t of Topics ?? [])
      if (t.TopicArn.endsWith(`:${topic}`)) await call("sns", "DeleteTopic", { TopicArn: t.TopicArn }).catch(() => {});
  }
});
