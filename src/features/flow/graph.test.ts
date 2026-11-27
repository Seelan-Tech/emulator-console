import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildGraph,
  COL_GAP,
  filterFlows,
  type FlowInput,
  isProblem,
  layout,
  NODE_H,
  NODE_W,
  splitFlows,
} from "./graph";

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

// ---- flows -----------------------------------------------------------------------------------------------------

// n separate topics, each with a queue; the topic named in `broken` has no permission
function manyFlows(n: number, broken: string[] = []) {
  return buildGraph(
    input({
      topics: Array.from({ length: n }, (_, i) => ({
        arn: T(`t${i}`),
        subscriptions: [
          {
            arn: `s${i}`,
            protocol: "sqs",
            endpoint: Q(`q${i}`),
            health: broken.includes(`t${i}`) ? ("needs-permission" as const) : ("delivers" as const),
          },
        ],
      })),
      queues: Array.from({ length: n }, (_, i) => queue(`q${i}`)),
    }),
  );
}

test("separate groups of connected resources become separate flows, and a lone resource is in none", () => {
  const g = manyFlows(3);
  g.nodes.push({ id: "lonely", kind: "queue", label: "lonely" });
  const flows = splitFlows(g);
  assert.equal(flows.length, 3);
  assert.ok(flows.every((f) => f.graph.nodes.length === 2 && f.graph.edges.length === 1));
  assert.ok(!flows.some((f) => f.graph.nodes.some((n) => n.id === "lonely")));
});

test("resources joined through a shared queue or a chain stay in one flow", () => {
  const g = buildGraph(
    input({
      topics: [
        { arn: T("a"), subscriptions: [{ arn: "s1", protocol: "sqs", endpoint: Q("shared"), health: "delivers" }] },
        { arn: T("b"), subscriptions: [{ arn: "s2", protocol: "sqs", endpoint: Q("shared"), health: "delivers" }] },
      ],
      queues: [queue("shared", { deadLetterTargetArn: Q("dlq") }), queue("dlq")],
    }),
  );
  const flows = splitFlows(g);
  assert.equal(flows.length, 1);
  assert.equal(flows[0]!.graph.nodes.length, 4);
  assert.equal(flows[0]!.graph.edges.length, 3);
  // named after where it starts
  assert.equal(flows[0]!.title, "a, b");
});

test("a flow with many sources is titled with two names and a count", () => {
  const g = buildGraph(
    input({
      topics: ["a", "b", "c", "d"].map((n) => ({
        arn: T(n),
        subscriptions: [{ arn: `s${n}`, protocol: "sqs", endpoint: Q("one"), health: "delivers" as const }],
      })),
      queues: [queue("one")],
    }),
  );
  assert.equal(splitFlows(g)[0]!.title, "a, b and 2 more");
});

test("flows with a problem come first, then the bigger ones", () => {
  const flows = splitFlows(manyFlows(4, ["t3"]));
  assert.equal(flows[0]!.problems, 1);
  assert.equal(flows[0]!.title, "t3");
  assert.deepEqual(
    flows.slice(1).map((f) => f.title),
    ["t0", "t1", "t2"],
  );
});

test("what counts as a problem: a missing permission or endpoint, an unknown check, a trigger that is not enabled", () => {
  const e = (x: object) => ({ id: "e", kind: "subscription", from: "a", to: "b", ...x }) as never;
  assert.equal(isProblem(e({ health: "needs-permission" })), true);
  assert.equal(isProblem(e({ health: "missing" })), true);
  assert.equal(isProblem(e({ health: "unknown" })), true);
  assert.equal(isProblem(e({ health: "delivers" })), false);
  assert.equal(isProblem(e({ health: "pending" })), false);
  assert.equal(isProblem(e({ health: "no-delivery" })), false);
  assert.equal(isProblem(e({ kind: "event-source", note: "Disabled" })), true);
  assert.equal(isProblem(e({ kind: "event-source" })), false);
  // a rule that is switched off on purpose is not something to fix
  assert.equal(isProblem(e({ kind: "rule", health: "needs-permission", disabled: true })), false);
  assert.equal(isProblem(e({ kind: "rule", health: "needs-permission" })), true);
});

test("the filter keeps flows with a problem and flows with a resource or rule whose name matches", () => {
  const flows = splitFlows(manyFlows(5, ["t1"]));
  assert.equal(filterFlows(flows, { problemsOnly: false, query: "" }).length, 5);
  assert.deepEqual(
    filterFlows(flows, { problemsOnly: true, query: "" }).map((f) => f.title),
    ["t1"],
  );
  // a match on the queue finds the flow of its topic, whatever the case
  assert.deepEqual(
    filterFlows(flows, { problemsOnly: false, query: " Q3 " }).map((f) => f.title),
    ["t3"],
  );
  assert.equal(filterFlows(flows, { problemsOnly: true, query: "q3" }).length, 0);
  assert.equal(filterFlows(flows, { problemsOnly: false, query: "nothing" }).length, 0);
});

test("a rule's name can be searched", () => {
  const g = buildGraph(
    input({
      queues: [queue("q")],
      rules: [
        {
          bus: "b",
          busArn: "arn:aws:events:us-east-1:000000000000:event-bus/b",
          rule: "on-order",
          ruleArn: "arn:aws:events:us-east-1:000000000000:rule/b/on-order",
          enabled: true,
          targets: [{ id: "1", arn: Q("q"), health: "delivers" }],
        },
      ],
    }),
  );
  assert.equal(filterFlows(splitFlows(g), { problemsOnly: false, query: "on-ord" }).length, 1);
});

test("a hundred separate flows are split and laid out quickly", () => {
  const started = Date.now();
  const flows = splitFlows(manyFlows(300, ["t7"]));
  for (const f of flows) layout(f.graph);
  assert.equal(flows.length, 300);
  assert.ok(Date.now() - started < 2000);
});
