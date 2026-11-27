import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { mockFetch, opOk, renderApp } from "../../../tests/support/render";
import { edgeLook, FlowView, lineLabel } from "./flow-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/t/t1/flow" }));
afterEach(() => vi.unstubAllGlobals());

const Q = (n: string) => `arn:aws:sqs:us-east-1:000000000000:${n}`;
const T = "arn:aws:sns:us-east-1:000000000000:orders";
const policy = (queue: string, topic: string) =>
  JSON.stringify({
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "sns.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: queue,
        Condition: { ArnEquals: { "aws:SourceArn": topic } },
      },
    ],
  });

function routes(over: Record<string, unknown> = {}) {
  return mockFetch([
    ["/sqs/ListQueues", opOk({ QueueUrls: ["http://e/0/billing", "http://e/0/blocked", "http://e/0/dlq"] })],
    [
      "/sqs/GetQueueAttributes",
      (_u: string, init?: RequestInit) => {
        const { QueueUrl } = JSON.parse(init?.body as string) as { QueueUrl: string };
        const name = QueueUrl.split("/").pop()!;
        return opOk({
          Attributes: {
            QueueArn: Q(name),
            ApproximateNumberOfMessages: name === "billing" ? "3" : "0",
            ...(name === "billing"
              ? { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Q("dlq") }), Policy: policy(Q("billing"), T) }
              : {}),
          },
        });
      },
    ],
    ["/lambda/ListFunctions", opOk({ Functions: [] })],
    ["/lambda/ListEventSourceMappings", over.mappings ?? opOk({ EventSourceMappings: [] })],
    ["/eventbridge/ListEventBuses", over.buses ?? opOk({ EventBuses: [] })],
    ["/eventbridge/ListRules", over.rules ?? opOk({ Rules: [] })],
    ["/eventbridge/ListTargetsByRule", over.targets ?? opOk({ Targets: [] })],
    ["/sns/ListTopics", opOk({ Topics: [{ TopicArn: T }] })],
    [
      "/sns/ListSubscriptionsByTopic",
      opOk({
        Subscriptions: [
          { SubscriptionArn: "s1", Protocol: "sqs", Endpoint: Q("billing") },
          { SubscriptionArn: "s2", Protocol: "sqs", Endpoint: Q("blocked") },
          { SubscriptionArn: "s3", Protocol: "sqs", Endpoint: Q("gone") },
        ],
      }),
    ],
  ]);
}

describe("FlowView", () => {
  test("draws the connections and lists them, with what each one does", async () => {
    routes();
    renderApp(<FlowView />);
    const table = await screen.findByTestId("flow-table");
    const row = (from: string, to: string) =>
      within(table)
        .getAllByRole("row")
        .find((r) => r.textContent?.includes(from) && r.textContent.includes(to))!;
    expect(row("orders", "billing").textContent).toContain("delivers");
    expect(row("orders", "blocked").textContent).toContain("needs permission");
    expect(row("orders", "gone").textContent).toContain("endpoint missing");
    expect(row("billing", "dlq").textContent).toContain("dead letters");
    // a queue's waiting messages show on its box, and a box of an existing resource is a link
    expect(screen.getByRole("link", { name: /^SQS queue\s*billing/ })).toHaveAttribute("href", "/t/t1/sqs/billing");
    expect(screen.getByText("3 waiting")).toBeInTheDocument();
    // the one that does not exist is not a link
    expect(screen.queryByRole("link", { name: /^SQS queue\s*gone/ })).toBeNull();
  });

  test("says so when nothing is connected, and lists the resources apart", async () => {
    mockFetch([
      ["/sqs/ListQueues", opOk({ QueueUrls: ["http://e/0/solo"] })],
      ["/sqs/GetQueueAttributes", opOk({ Attributes: { QueueArn: Q("solo") } })],
      ["/lambda/ListFunctions", opOk({ Functions: [] })],
      ["/lambda/ListEventSourceMappings", opOk({ EventSourceMappings: [] })],
      ["/eventbridge/ListEventBuses", opOk({ EventBuses: [] })],
      ["/sns/ListTopics", opOk({ Topics: [] })],
    ]);
    renderApp(<FlowView />);
    expect(await screen.findByText("Nothing is connected yet")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Not connected" })).getByText("solo")).toBeInTheDocument();
  });

  test("a service that does not answer is a warning, and the rest is still drawn", async () => {
    routes({
      mappings: new Response(JSON.stringify({ ok: false, ms: 1, error: { name: "Boom", message: "no mappings" } })),
    });
    renderApp(<FlowView />);
    expect(await screen.findByText(/Could not read Lambda event sources: no mappings/)).toBeInTheDocument();
    expect(await screen.findByTestId("flow-table")).toBeInTheDocument();
  });

  test("an event source mapping is a line from its queue to the function", async () => {
    routes({
      mappings: opOk({
        EventSourceMappings: [
          {
            UUID: "m1",
            FunctionArn: "arn:aws:lambda:us-east-1:000000000000:function:worker",
            EventSourceArn: Q("billing"),
            State: "Enabled",
          },
        ],
      }),
    });
    renderApp(<FlowView />);
    const table = await screen.findByTestId("flow-table");
    const r = within(table)
      .getAllByRole("row")
      .find((x) => x.textContent?.includes("worker"))!;
    expect(r.textContent).toContain("billing");
    expect(r.textContent).toContain("triggers");
  });
});

describe("rules in the flow", () => {
  const BUS = "arn:aws:events:us-east-1:000000000000:event-bus/orders";
  const RULE = "arn:aws:events:us-east-1:000000000000:rule/orders/audit";
  const rules = (state = "ENABLED") => ({
    buses: opOk({ EventBuses: [{ Name: "orders", Arn: BUS }] }),
    rules: opOk({ Rules: [{ Name: "audit", Arn: RULE, State: state }] }),
    // billing allows this rule (its policy is read with the queues), blocked does not
    targets: opOk({
      Targets: [
        { Id: "a", Arn: Q("billing") },
        { Id: "b", Arn: Q("blocked") },
        { Id: "k", Arn: "arn:aws:kinesis:us-east-1:000000000000:stream/clicks" },
      ],
    }),
  });

  test("a rule is a line from its bus to each target, with the rule's name and what it needs", async () => {
    mockFetch([
      ["/sqs/ListQueues", opOk({ QueueUrls: ["http://e/0/billing", "http://e/0/blocked"] })],
      [
        "/sqs/GetQueueAttributes",
        (_u: string, init?: RequestInit) => {
          const name = (JSON.parse(init?.body as string) as { QueueUrl: string }).QueueUrl.split("/").pop()!;
          const allowed = name === "billing";
          return opOk({
            Attributes: {
              QueueArn: Q(name),
              ...(allowed
                ? {
                    Policy: JSON.stringify({
                      Statement: [
                        {
                          Effect: "Allow",
                          Principal: { Service: "events.amazonaws.com" },
                          Action: "sqs:SendMessage",
                          Condition: { ArnEquals: { "aws:SourceArn": RULE } },
                        },
                      ],
                    }),
                  }
                : {}),
            },
          });
        },
      ],
      ["/lambda/ListFunctions", opOk({ Functions: [] })],
      ["/lambda/ListEventSourceMappings", opOk({ EventSourceMappings: [] })],
      ["/sns/ListTopics", opOk({ Topics: [] })],
      ["/eventbridge/ListEventBuses", rules().buses],
      ["/eventbridge/ListRules", rules().rules],
      ["/eventbridge/ListTargetsByRule", rules().targets],
    ]);
    renderApp(<FlowView />);
    const table = await screen.findByTestId("flow-table");
    const row = (to: string) =>
      within(table)
        .getAllByRole("row")
        .find((r) => r.textContent?.includes("orders") && r.textContent.includes(to))!;
    expect(row("billing").textContent).toContain("audit: delivers");
    expect(row("blocked").textContent).toContain("audit: needs permission");
    expect(row("clicks").textContent).toContain("audit: not checked");
    // the line names the rule and links to its page
    expect(within(row("billing")).getByRole("link", { name: "audit: delivers" })).toHaveAttribute(
      "href",
      "/t/t1/eventbridge/orders/audit",
    );
    // the bus is a box that opens the bus
    expect(screen.getByRole("link", { name: /^Event bus\s*orders/ })).toHaveAttribute(
      "href",
      "/t/t1/eventbridge/orders",
    );
  });

  test("a disabled rule is marked as such", async () => {
    routes({ ...rules("DISABLED") });
    renderApp(<FlowView />);
    const table = await screen.findByTestId("flow-table");
    expect(within(table).getAllByText(/audit \(disabled\):/).length).toBeGreaterThan(0);
  });

  test("the diagram writes only a rule's name on its line, shortened, and the full words are in the table", () => {
    expect(lineLabel({ kind: "rule", label: "audit", health: "delivers" })).toBe("audit");
    expect(lineLabel({ kind: "rule", label: "audit", disabled: true })).toBe("audit (off)");
    expect(lineLabel({ kind: "rule", label: "a-very-long-rule-name-indeed" })).toBe("a-very-long-rule-…");
    expect(lineLabel({ kind: "subscription", health: "delivers" })).toBe("delivers");
    expect(lineLabel({ kind: "dead-letter" })).toBe("dead letters");
  });

  test("a rule's lines say so in words and the colour follows what is wrong", () => {
    expect(edgeLook({ kind: "rule", label: "audit", health: "delivers" })).toMatchObject({
      label: "audit: delivers",
      tone: "text-success",
      dashed: false,
    });
    expect(edgeLook({ kind: "rule", label: "audit", health: "needs-permission" }).tone).toBe("text-warning-text");
    expect(edgeLook({ kind: "rule", label: "audit", health: "delivers", disabled: true })).toMatchObject({
      label: "audit (disabled): delivers",
      tone: "text-muted-foreground",
      dashed: true,
    });
    expect(edgeLook({ kind: "rule", health: "not-checked" }).label).toBe("rule: not checked");
  });
});

test("every kind of line says what it is in words", () => {
  expect(edgeLook({ kind: "subscription", health: "delivers" }).label).toBe("delivers");
  expect(edgeLook({ kind: "subscription", health: "no-delivery" }).label).toBe("will not deliver");
  expect(edgeLook({ kind: "subscription", health: "pending" }).label).toBe("pending confirmation");
  expect(edgeLook({ kind: "subscription" }).label).toBe("unknown");
  expect(edgeLook({ kind: "event-source", note: "Disabled" }).label).toBe("triggers (Disabled)");
  expect(edgeLook({ kind: "dead-letter" }).dashed).toBe(true);
});
