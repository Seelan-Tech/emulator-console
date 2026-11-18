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
    await expect(page.getByText("delivers", { exact: true })).toBeVisible(); // the policy was added by the dialog

    // an email subscription stays pending
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await page.getByLabel("Protocol").selectOption("email");
    await expect(page.getByRole("note")).toContainText("never confirms email subscriptions");
    await page.getByLabel("Endpoint").fill("someone@example.com");
    await page.getByRole("dialog").getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByText("pending confirmation")).toBeVisible();
    // SNS cannot remove a pending subscription: the button is there, disabled, not missing
    await expect(page.getByRole("button", { name: "Cannot remove someone@example.com" })).toBeDisabled();

    // Beautify shows only for JSON, and re-indents it
    await page.getByRole("tab", { name: "Publish" }).click();
    await typeInEditor(page, '{"a":1}');
    await page.getByRole("button", { name: "Beautify JSON" }).click();
    await expect(page.locator(".cm-content").first()).toContainText('"a": 1');
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(page.getByRole("button", { name: "Beautify JSON" })).toHaveCount(0);

    // publish with a subject and an attribute; the queue receives it
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

test("SNS: subscription health flags a function and a queue that do not allow the topic, and Fix delivers", async ({
  page,
  target,
  call,
}) => {
  const topic = uniq("e2e-health");
  const fn = uniq("e2e-hfn");
  const queue = uniq("e2e-hq");
  const marker = uniq("marker");
  const source = `def handler(event, context):\n    print("${marker}", event["Records"][0]["Sns"]["Message"])\n`;
  let topicArn: string | undefined;
  let QueueUrl: string | undefined;
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
    QueueUrl = (await call("sqs", "CreateQueue", { QueueName: queue })).QueueUrl as string;
    const queueArn = (await call("sqs", "GetQueueAttributes", { QueueUrl, AttributeNames: ["QueueArn"] })).Attributes
      .QueueArn as string;
    topicArn = (await call("sns", "CreateTopic", { Name: topic })).TopicArn as string;
    // subscribed from outside the console: no permission on either endpoint
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "lambda", Endpoint: fnArn });
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn });

    await page.goto(`${target.base}/sns/${encodeURIComponent(topic)}`);
    await expect(page.getByRole("tab", { name: /Subscriptions \(2, 2 need attention\)/ })).toBeVisible();
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await expect(page.getByText("needs permission")).toHaveCount(2);

    await page.getByRole("button", { name: `Allow topic on ${fnArn}` }).click();
    await expect(page.getByText("delivers", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: `Allow topic on ${queueArn}` }).click();
    await expect(page.getByText("delivers", { exact: true })).toHaveCount(2);
    await expect(page.getByText("needs permission")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Subscriptions \(2\)/ })).toBeVisible();

    // and the function and the queue now get what is published
    await call("sns", "Publish", { TopicArn: topicArn, Message: "hello health" });
    await expect
      .poll(
        async () => {
          const r = await call("logs", "FilterLogEvents", { logGroupName: `/aws/lambda/${fn}` }).catch(() => null);
          return (r?.events ?? []).some((e: { message: string }) => e.message.includes(`${marker} hello health`));
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const r = await call("sqs", "ReceiveMessage", { QueueUrl, WaitTimeSeconds: 0, VisibilityTimeout: 0 });
          return r.Messages?.length ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // an endpoint that is gone is reported as missing
    await call("lambda", "DeleteFunction", { FunctionName: fn });
    await page.reload();
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await expect(page.getByText("endpoint missing")).toHaveCount(1);
  } finally {
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
    if (QueueUrl) await call("sqs", "DeleteQueue", { QueueUrl }).catch(() => {});
    await call("lambda", "DeleteFunction", { FunctionName: fn }).catch(() => {});
    await call("logs", "DeleteLogGroup", { logGroupName: `/aws/lambda/${fn}` }).catch(() => {});
  }
});

test("SNS: an http endpoint is checked in the dialog before it is sent", async ({ page, target, call }) => {
  const topic = uniq("e2e-http");
  let topicArn: string | undefined;
  try {
    topicArn = (await call("sns", "CreateTopic", { Name: topic })).TopicArn as string;
    await page.goto(`${target.base}/sns/${encodeURIComponent(topic)}`);
    await page.getByRole("tab", { name: /Subscriptions/ }).click();
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Subscribe" });
    await page.getByLabel("Protocol").selectOption("http");

    await page.getByLabel("Endpoint").fill("example.com/hook");
    await expect(dialog.getByRole("alert")).toContainText("starts with http://");
    await expect(submit).toBeDisabled();
    await page.getByLabel("Endpoint").fill("https://example.com/hook");
    await expect(dialog.getByRole("alert")).toContainText("choose the https protocol");
    await expect(submit).toBeDisabled();

    // a valid URL (surrounding spaces are trimmed) subscribes and stays pending
    await page.getByLabel("Endpoint").fill("  http://localhost:8080/hook ");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await submit.click();
    await expectToast(page, "Subscribed");
    await expect(page.getByRole("cell", { name: "http://localhost:8080/hook", exact: true })).toBeVisible();
    await expect(page.getByText("pending confirmation")).toBeVisible();
  } finally {
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
  }
});
