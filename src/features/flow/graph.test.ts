import assert from "node:assert/strict";

import { test } from "vitest";

import { buildGraph, COL_GAP, type FlowInput, layout, NODE_H, NODE_W } from "./graph";

const T = (n: string) => `arn:aws:sns:us-east-1:000000000000:${n}`;
const Q = (n: string) => `arn:aws:sqs:us-east-1:000000000000:${n}`;
const F = (n: string) => `arn:aws:lambda:us-east-1:000000000000:function:${n}`;
const queue = (name: string, extra: object = {}) => ({
  url: `http://e/0/${name}`,
  name,
  arn: Q(name),
  available: 0,
  inFlight: 0,
  delayed: 0,
  ...extra,
});
const input = (o: Partial<FlowInput> = {}): FlowInput => ({
  base: "/t/1",
  topics: [],
  queues: [],
  functions: [],
  mappings: [],
  ...o,
});

test("a topic with a queue and a function subscribed becomes nodes and edges with their health", () => {
  const g = buildGraph(
    input({
      topics: [
        {
          arn: T("orders"),
          subscriptions: [
            { arn: "s1", protocol: "sqs", endpoint: Q("billing"), health: "delivers" },
            { arn: "s2", protocol: "lambda", endpoint: F("audit"), health: "needs-permission" },
          ],
        },
      ],
      queues: [queue("billing", { available: 3, inFlight: 1 })],
      functions: [{ name: "audit", arn: F("audit") }],
    }),
  );
  assert.deepEqual(g.nodes.map((n) => `${n.kind}:${n.label}`).sort(), [
    "function:audit",
    "queue:billing",
    "topic:orders",
  ]);
  assert.deepEqual(
    g.edges.map((e) => `${e.kind} ${e.from.split(":").pop()}>${e.to.split(":").pop()} ${e.health}`),
    ["subscription orders>billing delivers", "subscription orders>audit needs-permission"],
  );
  const billing = g.nodes.find((n) => n.label === "billing")!;
  assert.equal(billing.sub, "3 waiting · 1 in flight");
  assert.equal(billing.href, "/t/1/sqs/billing");
  assert.equal(g.nodes.find((n) => n.label === "orders")!.href, "/t/1/sns/orders");
});

test("an endpoint that was not found is a ghost node, and a subscription of another kind is an outside node", () => {
  const g = buildGraph(
    input({
      topics: [
        {
          arn: T("t"),
          subscriptions: [
            { arn: "s1", protocol: "sqs", endpoint: Q("gone"), health: "missing" },
            { arn: "s2", protocol: "https", endpoint: "https://example.com/hook" },
            { arn: "PendingConfirmation", protocol: "sqs", endpoint: Q("later") },
          ],
        },
      ],
    }),
  );
  const gone = g.nodes.find((n) => n.label === "gone")!;
  assert.equal(gone.ghost, true);
  assert.equal(gone.kind, "queue");
  assert.equal(g.nodes.find((n) => n.id === "ext:https:https://example.com/hook")!.kind, "other");
  assert.deepEqual(
    g.edges.map((e) => e.health),
    ["missing", "no-delivery", "pending"],
  );
});

test("a queue's dead-letter queue and an event source mapping are edges", () => {
  const g = buildGraph(
    input({
      queues: [queue("jobs", { deadLetterTargetArn: Q("jobs-dlq") }), queue("jobs-dlq")],
      functions: [{ name: "worker", arn: F("worker") }],
      mappings: [
        { id: "m1", functionArn: `${F("worker")}:live`, eventSourceArn: Q("jobs") },
        {
          id: "m2",
          functionArn: F("worker"),
          eventSourceArn: "arn:aws:kinesis:us-east-1:0:stream/clicks",
          state: "Disabled",
        },
      ],
    }),
  );
  assert.deepEqual(
    g.edges.map((e) => `${e.kind} ${e.from.split(/[:/]/).pop()}>${e.to.split(":").pop()}${e.note ? ` ${e.note}` : ""}`),
    ["dead-letter jobs>jobs-dlq", "event-source jobs>worker", "event-source clicks>worker Disabled"],
  );
  // the version in the ARN does not make a second function
  assert.equal(g.nodes.filter((n) => n.kind === "function").length, 1);
  assert.equal(g.nodes.find((n) => n.label === "clicks")!.kind, "other");
});

test("a node goes one column right of everything that feeds it", () => {
  const g = buildGraph(
    input({
      topics: [{ arn: T("t"), subscriptions: [{ arn: "s", protocol: "sqs", endpoint: Q("q"), health: "delivers" }] }],
      queues: [queue("q"), queue("other")],
      functions: [{ name: "f", arn: F("f") }],
      mappings: [{ id: "m", functionArn: F("f"), eventSourceArn: Q("q") }],
    }),
  );
  const l = layout(g);
  const col = (label: string) => l.nodes.find((n) => n.label === label)!.layer;
  assert.deepEqual([col("t"), col("q"), col("f")], [0, 1, 2]);
  assert.deepEqual(
    l.isolated.map((n) => n.label),
    ["other"],
  );
  assert.equal(l.width, 16 * 2 + 3 * NODE_W + 2 * COL_GAP);
  // a line leaves the right side of its source and enters the left side of its target
  const e = l.edges.find((x) => x.kind === "subscription")!;
  const a = l.nodes.find((n) => n.label === "t")!;
  assert.match(e.path, new RegExp(`^M ${a.x + NODE_W} ${a.y + NODE_H / 2} C `));
});

test("rows are ordered so that lines do not cross", () => {
  // a1 feeds b1, a2 feeds b2: whatever the names say, the pairs line up
  const g = buildGraph(
    input({
      topics: [
        { arn: T("a1"), subscriptions: [{ arn: "s1", protocol: "sqs", endpoint: Q("z"), health: "delivers" }] },
        { arn: T("a2"), subscriptions: [{ arn: "s2", protocol: "sqs", endpoint: Q("b"), health: "delivers" }] },
      ],
      queues: [queue("z"), queue("b")],
    }),
  );
  const l = layout(g);
  const y = (label: string) => l.nodes.find((n) => n.label === label)!.y;
  assert.equal(y("a1") < y("a2"), y("z") < y("b"));
});

test("a cycle does not hang the layout, and an empty graph is empty", () => {
  const g = buildGraph(
    input({
      queues: [
        queue("a", { deadLetterTargetArn: Q("b") }),
        queue("b", { deadLetterTargetArn: Q("a") }),
        queue("self", { deadLetterTargetArn: Q("self") }),
      ],
    }),
  );
  const l = layout(g);
  assert.equal(l.nodes.length, 3);
  assert.equal(l.edges.length, 3);
  const empty = layout(buildGraph(input()));
  assert.deepEqual([empty.nodes.length, empty.edges.length, empty.isolated.length], [0, 0, 0]);
});

const BUS = (n: string) => `arn:aws:events:us-east-1:000000000000:event-bus/${n}`;
const RULE = (bus: string, n: string) => `arn:aws:events:us-east-1:000000000000:rule/${bus}/${n}`;
const rule = (bus: string, name: string, targets: { id: string; arn: string; health: never }[], enabled = true) => ({
  bus,
  busArn: BUS(bus),
  rule: name,
  ruleArn: RULE(bus, name),
  enabled,
  targets,
});

test("a rule is a line from its bus to each target, named after the rule and linking to it", () => {
  const g = buildGraph(
    input({
      queues: [queue("audit")],
      functions: [{ name: "worker", arn: F("worker") }],
      rules: [
        rule("orders", "to-audit", [{ id: "a", arn: Q("audit"), health: "delivers" as never }]),
        rule("orders", "to-worker", [{ id: "w", arn: F("worker"), health: "needs-permission" as never }], false),
      ],
    }),
  );
  const bus = g.nodes.find((n) => n.kind === "bus")!;
  assert.equal(bus.label, "orders");
  assert.equal(bus.href, "/t/1/eventbridge/orders");
  assert.equal(g.nodes.filter((n) => n.kind === "bus").length, 1); // one bus for both rules
  assert.deepEqual(
    g.edges.map(
      (e) => `${e.kind} ${e.label} ${e.to.split(/[:/]/).pop()} ${e.health}${e.disabled ? " disabled" : ""} ${e.href}`,
    ),
    [
      "rule to-audit audit delivers /t/1/eventbridge/orders/to-audit",
      "rule to-worker worker needs-permission disabled /t/1/eventbridge/orders/to-worker",
    ],
  );
  assert.ok(g.edges.every((e) => e.from === BUS("orders")));
});

test("a rule's target that was not found, or is not a queue, function or topic, is a ghost node", () => {
  const g = buildGraph(
    input({
      rules: [
        rule("default", "r", [
          { id: "q", arn: Q("gone"), health: "missing" as never },
          { id: "k", arn: "arn:aws:kinesis:us-east-1:0:stream/clicks", health: "not-checked" as never },
        ]),
      ],
    }),
  );
  assert.equal(g.nodes.find((n) => n.label === "gone")!.ghost, true);
  assert.equal(g.nodes.find((n) => n.label === "clicks")!.kind, "other");
  assert.deepEqual(
    g.edges.map((e) => e.health),
    ["missing", "not-checked"],
  );
});

test("a rule can send events to another bus, and a bus whose rules have no target is not connected", () => {
  const g = buildGraph(
    input({
      rules: [
        rule("orders", "forward", [{ id: "b", arn: BUS("audit"), health: "not-checked" as never }]),
        rule("audit", "all", [{ id: "x", arn: Q("sink"), health: "delivers" as never }]),
        rule("idle", "nothing", []),
      ],
    }),
  );
  // the forward rule lands on the audit bus node, which is also the source of the next rule
  const forward = g.edges.find((e) => e.label === "forward")!;
  assert.equal(forward.to, BUS("audit"));
  assert.equal(g.nodes.filter((n) => n.kind === "bus").length, 3);
  const l = layout(g);
  assert.deepEqual(
    l.isolated.map((n) => n.label),
    ["idle"],
  );
  const col = (label: string) => l.nodes.find((n) => n.label === label)!.layer;
  assert.deepEqual([col("orders"), col("audit"), col("sink")], [0, 1, 2]);
});

test("lines between the same two boxes are spread apart instead of drawn on top of each other", () => {
  const g = buildGraph(
    input({
      queues: [queue("sink")],
      rules: [
        rule("bus", "one", [{ id: "a", arn: Q("sink"), health: "delivers" as never }]),
        rule("bus", "two", [{ id: "b", arn: Q("sink"), health: "delivers" as never }]),
        rule("bus", "three", [{ id: "c", arn: Q("sink"), health: "delivers" as never }]),
      ],
    }),
  );
  const l = layout(g);
  const ys = l.edges.map((e) => e.mid.y);
  assert.equal(new Set(ys).size, 3);
  assert.equal(new Set(l.edges.map((e) => e.path)).size, 3);
  // centred on the middle of the boxes, so the middle line is straight
  assert.equal(ys[1], l.nodes.find((n) => n.label === "sink")!.y + NODE_H / 2);
  // a single line is not moved
  const single = layout(
    buildGraph(
      input({ queues: [queue("s")], rules: [rule("b", "r", [{ id: "a", arn: Q("s"), health: "delivers" as never }])] }),
    ),
  );
  const s = single.nodes.find((n) => n.label === "s")!;
  assert.equal(single.edges[0]!.mid.y, (single.nodes.find((n) => n.label === "b")!.y + s.y + NODE_H) / 2);
});
