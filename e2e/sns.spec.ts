import type { Page } from "@playwright/test";

import { makeZip } from "../src/features/lambda/zip";
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
    await expect(page.getByRole("note")).toContainText("never confirms email subscriptions");
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

test("SNS: subscribing a function adds the permission, so a publish invokes it", async ({ page, target, call }) => {
  const topic = uniq("e2e-lamtopic");
  const fn = uniq("e2e-lamfn");
  const marker = uniq("marker");
  const source = `def handler(event, context):\n    print("${marker}", event["Records"][0]["Sns"]["Message"])\n`;
  let topicArn: string | undefined;
  try {
    await call("lambda", "CreateFunction", {
      FunctionName: fn,
      Runtime: "python3.12",
      Role: "arn:aws:iam::000000000000:role/lambda-role",
      Handler: "index.handler",
      Code: { ZipFile: { $base64: Buffer.from(makeZip("index.py", source)).toString("base64") } },
    });
    let fnArn = "";
    for (let i = 0; i < 60; i++) {
      const c = await call("lambda", "GetFunctionConfiguration", { FunctionName: fn });
      fnArn = c.FunctionArn;
      if (c.State === "Active" && c.LastUpdateStatus !== "InProgress") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    topicArn = (await call("sns", "CreateTopic", { Name: topic })).TopicArn as string;

    await page.goto(`${target.base}/sns/${encodeURIComponent(topic)}`);
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await page.getByLabel("Protocol").selectOption("lambda");
    await expect(page.getByLabel("Allow topic to invoke the function")).toBeChecked();
    await page.getByLabel("Endpoint").fill(fnArn);
    await page.getByRole("dialog").getByRole("button", { name: "Subscribe" }).click();
    await expectToast(page, "Subscribed");

    const policy = JSON.parse((await call("lambda", "GetPolicy", { FunctionName: fn })).Policy);
    expect(policy.Statement).toEqual([
      expect.objectContaining({
        Principal: { Service: "sns.amazonaws.com" },
        Action: "lambda:InvokeFunction",
        Condition: { ArnLike: { "AWS:SourceArn": topicArn } },
      }),
    ]);

    await call("sns", "Publish", { TopicArn: topicArn, Message: "hello function" });
    await expect
      .poll(
        async () => {
          const r = await call("logs", "FilterLogEvents", { logGroupName: `/aws/lambda/${fn}` }).catch(() => null);
          return (r?.events ?? []).some((e: { message: string }) => e.message.includes(`${marker} hello function`));
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  } finally {
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
    await call("lambda", "DeleteFunction", { FunctionName: fn }).catch(() => {});
    await call("logs", "DeleteLogGroup", { logGroupName: `/aws/lambda/${fn}` }).catch(() => {});
  }
});
