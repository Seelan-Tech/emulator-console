import AxeBuilder from "@axe-core/playwright";

import { expect, test, uniq } from "./fixtures";

test("the message flow shows who delivers to whom, what is missing a permission and dead-letter queues", async ({
  page,
  target,
  call,
}) => {
  const names = {
    topic: uniq("e2e-flow-t"),
    ok: uniq("e2e-flow-ok"),
    blocked: uniq("e2e-flow-no"),
    dlq: uniq("e2e-flow-dlq"),
    lonely: uniq("e2e-flow-solo"),
  };
  const urls: Record<string, string> = {};
  let topicArn = "";
  try {
    const arns: Record<string, string> = {};
    for (const key of ["dlq", "blocked", "lonely"] as const) {
      urls[key] = (await call("sqs", "CreateQueue", { QueueName: names[key] })).QueueUrl;
    }
    topicArn = (await call("sns", "CreateTopic", { Name: names.topic })).TopicArn;
    for (const key of ["dlq", "blocked", "lonely"] as const)
      arns[key] = (
        await call("sqs", "GetQueueAttributes", { QueueUrl: urls[key], AttributeNames: ["QueueArn"] })
      ).Attributes.QueueArn;
    // the queue that delivers: its policy lets the topic send, and failed messages go to the dead-letter queue
    urls.ok = (
      await call("sqs", "CreateQueue", {
        QueueName: names.ok,
        Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arns.dlq, maxReceiveCount: 3 }) },
      })
    ).QueueUrl;
    arns.ok = (
      await call("sqs", "GetQueueAttributes", { QueueUrl: urls.ok, AttributeNames: ["QueueArn"] })
    ).Attributes.QueueArn;
    await call("sqs", "SetQueueAttributes", {
      QueueUrl: urls.ok,
      Attributes: {
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "sns.amazonaws.com" },
              Action: "sqs:SendMessage",
              Resource: arns.ok,
              Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
            },
          ],
        }),
      },
    });
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "sqs", Endpoint: arns.ok });
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "sqs", Endpoint: arns.blocked });

    await page.goto(`/t/${target.tid}/flow`);
    const row = (from: string, to: string) =>
      page.getByTestId("flow-table").getByRole("row").filter({ hasText: from }).filter({ hasText: to });
    await expect(row(names.topic, names.ok)).toContainText("delivers");
    await expect(row(names.topic, names.blocked)).toContainText("needs permission");
    await expect(row(names.ok, names.dlq)).toContainText("dead letters");
    // a queue with no connection is listed apart, not drawn
    await expect(page.getByRole("region", { name: "Not connected" })).toContainText(names.lonely);
    await expect(page.getByTestId("flow-diagram")).not.toContainText(names.lonely);
    // coloured lines and labels on a drawn diagram stay readable in both themes
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const found = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      ).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(found, scheme).toEqual([]);
    }
    // the diagram shows the connections too, and its boxes are links to the resources
    await expect(page.getByTestId("flow-diagram")).toContainText("needs permission");
    await page
      .getByTestId("flow-diagram")
      .getByRole("link", { name: new RegExp(`^SQS queue\\s*${names.ok}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sqs/${names.ok}$`));

    // the palette finds the page
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("message flow");
    await expect(page.getByRole("option", { name: /Message flow/ })).toBeVisible();
  } finally {
    for (const url of Object.values(urls)) await call("sqs", "DeleteQueue", { QueueUrl: url }).catch(() => {});
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
  }
});
