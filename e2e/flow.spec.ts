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
    // each group of connected resources is a card of its own
    const card = page.getByTestId("flow-card").filter({ hasText: names.topic });
    await expect(card).toHaveCount(1);
    const row = (from: string, to: string) =>
      page.getByTestId("flow-table").getByRole("row").filter({ hasText: from }).filter({ hasText: to });
    await expect(row(names.topic, names.ok)).toContainText("delivers");
    await expect(row(names.topic, names.blocked)).toContainText("needs permission");
    await expect(row(names.ok, names.dlq)).toContainText("dead letters");
    // a queue with no connection is listed apart, not drawn
    await expect(page.getByRole("region", { name: "Not connected" })).toContainText(names.lonely);
    await expect(page.getByTestId("flow-card").filter({ hasText: names.lonely })).toHaveCount(0);
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
    await expect(card.getByTestId("flow-diagram")).toContainText("needs permission");
    await page
      .getByTestId("flow-card")
      .filter({ hasText: names.topic })
      .getByTestId("flow-diagram")
      .getByRole("link", { name: new RegExp(`^SQS queue\\s*${names.ok}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sqs/${names.ok}$`));

    // the search narrows to the flow of one resource; "only connections with a problem" lists just the blocked one
    await page.goto(`/t/${target.tid}/flow`);
    await page.getByRole("searchbox", { name: "Search the flow" }).fill(names.ok);
    await expect(page.getByTestId("flow-card")).toHaveCount(1);
    await expect(page.getByTestId("flow-card")).toContainText(names.topic);
    await page.getByRole("searchbox", { name: "Search the flow" }).fill("");
    await page.getByTestId("flow-problems-only").check();
    await expect(page.getByTestId("flow-card").filter({ hasText: names.topic })).toHaveCount(1);
    await expect(row(names.topic, names.blocked)).toContainText("needs permission");
    await expect(row(names.topic, names.ok)).toHaveCount(0);

    // the palette finds the page
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("message flow");
    await expect(page.getByRole("option", { name: /Message flow/ })).toBeVisible();
  } finally {
    for (const url of Object.values(urls)) await call("sqs", "DeleteQueue", { QueueUrl: url }).catch(() => {});
    if (topicArn) await call("sns", "DeleteTopic", { TopicArn: topicArn }).catch(() => {});
  }
});

test("the message flow draws a bus's rules to their targets, named after the rule, with what each target needs", async ({
  page,
  target,
  call,
}) => {
  const names = {
    bus: uniq("e2e-flow-bus"),
    allowed: uniq("e2e-flow-yes"),
    blocked: uniq("e2e-flow-blk"),
    live: uniq("e2e-flow-r1"),
    off: uniq("e2e-flow-r2"),
  };
  const urls: Record<string, string> = {};
  const targets: Record<string, string[]> = { [names.live]: [], [names.off]: [] };
  let busCreated = false;
  try {
    const arn: Record<string, string> = {};
    for (const key of ["allowed", "blocked"] as const) {
      urls[key] = (await call("sqs", "CreateQueue", { QueueName: names[key] })).QueueUrl;
      arn[key] = (
        await call("sqs", "GetQueueAttributes", { QueueUrl: urls[key], AttributeNames: ["QueueArn"] })
      ).Attributes.QueueArn;
    }
    await call("eventbridge", "CreateEventBus", { Name: names.bus });
    busCreated = true;
    const pattern = JSON.stringify({ source: ["e2e.flow"] });
    const ruleArn: Record<string, string> = {};
    for (const [rule, state] of [
      [names.live, "ENABLED"],
      [names.off, "DISABLED"],
    ] as const)
      ruleArn[rule] = (
        await call("eventbridge", "PutRule", {
          Name: rule,
          EventBusName: names.bus,
          EventPattern: pattern,
          State: state,
        })
      ).RuleArn;
    const put = async (rule: string, id: string, queue: "allowed" | "blocked") => {
      await call("eventbridge", "PutTargets", {
        Rule: rule,
        EventBusName: names.bus,
        Targets: [{ Id: id, Arn: arn[queue] }],
      });
      targets[rule]!.push(id);
    };
    await put(names.live, "a", "allowed");
    await put(names.live, "b", "blocked");
    await put(names.off, "c", "blocked");
    // only the first queue lets the live rule in
    await call("sqs", "SetQueueAttributes", {
      QueueUrl: urls.allowed,
      Attributes: {
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "events.amazonaws.com" },
              Action: "sqs:SendMessage",
              Resource: arn.allowed,
              Condition: { ArnEquals: { "aws:SourceArn": ruleArn[names.live] } },
            },
          ],
        }),
      },
    });

    await page.goto(`/t/${target.tid}/flow`);
    const row = (to: string, what: string) =>
      page
        .getByTestId("flow-table")
        .getByRole("row")
        .filter({ hasText: names.bus })
        .filter({ hasText: to })
        .filter({ hasText: what });
    await expect(row(names.allowed, `${names.live}: delivers`)).toBeVisible();
    await expect(row(names.blocked, `${names.live}: needs permission`)).toBeVisible();
    // a rule that is switched off says so
    await expect(row(names.blocked, `${names.off} (disabled): needs permission`)).toBeVisible();
    // the diagram carries the rule's name too
    await expect(
      page
        .getByTestId("flow-card")
        .filter({ hasText: names.bus })
        .getByTestId("flow-diagram")
        .locator("text")
        .filter({ hasText: names.live.slice(0, 12) })
        .first(),
    ).toBeVisible();

    // a rule's line links to the rule, and the bus box to the bus
    await row(names.allowed, "delivers")
      .getByRole("link", { name: `${names.live}: delivers` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/eventbridge/${names.bus}/${names.live}$`));
    await page.goBack();
    await page
      .getByTestId("flow-card")
      .filter({ hasText: names.bus })
      .getByTestId("flow-diagram")
      .getByRole("link", { name: new RegExp(`^Event bus\\s*${names.bus}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/eventbridge/${names.bus}$`));

    // readable in both themes (the diagram now has rule labels and a bus box)
    await page.goto(`/t/${target.tid}/flow`);
    await expect(page.getByTestId("flow-card").filter({ hasText: names.bus })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const found = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      ).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(found, scheme).toEqual([]);
    }
  } finally {
    for (const [rule, ids] of Object.entries(targets)) {
      if (ids.length)
        await call("eventbridge", "RemoveTargets", { Rule: rule, EventBusName: names.bus, Ids: ids }).catch(() => {});
      await call("eventbridge", "DeleteRule", { Name: rule, EventBusName: names.bus }).catch(() => {});
    }
    if (busCreated) await call("eventbridge", "DeleteEventBus", { Name: names.bus }).catch(() => {});
    for (const url of Object.values(urls)) await call("sqs", "DeleteQueue", { QueueUrl: url }).catch(() => {});
  }
});
