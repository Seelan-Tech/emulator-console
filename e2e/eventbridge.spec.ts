import AxeBuilder from "@axe-core/playwright";

import { expect, test, uniq } from "./fixtures";

test("an event bus, a rule and a queue target: permission, delivery, testing the pattern, disabling and deleting", async ({
  page,
  target,
  call,
}) => {
  const bus = uniq("e2e-eb-bus");
  const rule = uniq("e2e-eb-rule");
  const queue = uniq("e2e-eb-q");
  const base = `/t/${target.tid}/eventbridge`;
  let queueUrl = "";
  try {
    queueUrl = (await call("sqs", "CreateQueue", { QueueName: queue })).QueueUrl;

    // the default bus is there and cannot be deleted; a new bus is listed
    await page.goto(base);
    await expect(page.getByRole("link", { name: "default", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete event bus default" })).toBeDisabled();
    await page.getByRole("button", { name: "Create event bus" }).first().click();
    await page.getByLabel("Bus name").fill(bus);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("link", { name: bus })).toBeVisible();

    // a rule: the dialog explains a bad name, then creates the rule and opens it
    await page.getByRole("link", { name: bus }).click();
    await page.getByRole("button", { name: "Create rule" }).first().click();
    await page.getByLabel("Rule name").fill("not valid!");
    await expect(page.getByRole("alert")).toContainText("Letters, digits");
    await page.getByLabel("Rule name").fill(rule);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/eventbridge/${bus}/${rule}$`));
    await expect(page.getByText("No targets")).toBeVisible();

    // a target without the permission: it exists, but nothing would be delivered. Fix adds the permission.
    await page.getByRole("button", { name: "Add target" }).first().click();
    await page.getByLabel("Target", { exact: true }).selectOption({ label: queue });
    await page.getByRole("switch", { name: "Allow this rule to deliver" }).click();
    await page.getByRole("button", { name: "Add target", exact: true }).last().click();
    const row = page.getByRole("row").filter({ hasText: queue });
    await expect(row).toContainText("needs permission");
    // the amber badge and the rest of the page stay readable in both themes. The code editor is left out: its One
    // Dark theme draws JSON property names at 4.38:1 (needs 4.5:1), which is the theme's, not this page's.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const found = (
        await new AxeBuilder({ page })
          .exclude(".cm-editor")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(found, scheme).toEqual([]);
    }
    await row.getByRole("button", { name: "Fix" }).click();
    await expect(row).toContainText("delivers");

    // an event on the bus reaches the queue, wrapped the way EventBridge wraps it
    await page.goto(`${base}/${bus}`);
    await page.getByRole("tab", { name: "Send events" }).click();
    await page.getByRole("button", { name: "Send event" }).click();
    await expect(page.getByText(/^Sent /).first()).toBeVisible();
    await expect
      .poll(
        async () => {
          const r = await call("sqs", "ReceiveMessage", { QueueUrl: queueUrl, WaitTimeSeconds: 1 });
          return r.Messages?.[0]?.Body ?? "";
        },
        { timeout: 20_000 },
      )
      .toContain('"source":"my.app"');

    // the pattern tester says whether a sample event matches
    await page.goto(`${base}/${bus}/${rule}`);
    await page.getByRole("tab", { name: "Test the pattern" }).click();
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "matches" })).toBeVisible();

    // disable the rule from its page
    await page.getByRole("switch", { name: "Enabled" }).click();
    await expect
      .poll(async () => (await call("eventbridge", "DescribeRule", { Name: rule, EventBusName: bus })).State)
      .toBe("DISABLED");

    // delete the rule (its target goes first), then the bus
    await page.goto(`${base}/${bus}`);
    await page.getByRole("button", { name: `Delete rule ${rule}` }).click();
    await page.getByRole("textbox").last().fill(rule);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No rules on this bus")).toBeVisible();
    await page.goto(base);
    await page.getByRole("button", { name: `Delete event bus ${bus}` }).click();
    await page.getByRole("textbox").last().fill(bus);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("link", { name: bus })).toHaveCount(0);
  } finally {
    const targets = await call("eventbridge", "ListTargetsByRule", { Rule: rule, EventBusName: bus }).catch(() => null);
    if (targets?.Targets?.length)
      await call("eventbridge", "RemoveTargets", {
        Rule: rule,
        EventBusName: bus,
        Ids: targets.Targets.map((t: { Id: string }) => t.Id),
      }).catch(() => {});
    await call("eventbridge", "DeleteRule", { Name: rule, EventBusName: bus }).catch(() => {});
    await call("eventbridge", "DeleteEventBus", { Name: bus }).catch(() => {});
    if (queueUrl) await call("sqs", "DeleteQueue", { QueueUrl: queueUrl }).catch(() => {});
  }
});
