import assert from "node:assert/strict";

import { test } from "vitest";

import {
  addRuleToPolicy,
  ruleStatementId,
  ruleTrigger,
  sampleEvent,
  targetHealth,
  targetHref,
  targetId,
  targetKind,
  validateBusName,
  validateDetail,
  validatePattern,
  validateRuleName,
  validateSchedule,
} from "./logic";

const RULE = "arn:aws:events:us-east-1:000000000000:rule/orders/audit";
const QUEUE = "arn:aws:sqs:us-east-1:000000000000:audit";

test("bus and rule names", () => {
  assert.equal(validateBusName("orders.v2"), null);
  assert.match(validateBusName("")!, /Enter a name/);
  assert.match(validateBusName("a b")!, /Letters, digits/);
  assert.match(validateBusName("Default")!, /exists already/);
  assert.match(validateBusName("x".repeat(257))!, /256/);
  assert.equal(validateRuleName("on-order_1.created"), null);
  assert.match(validateRuleName("x".repeat(65))!, /64/);
  assert.match(validateRuleName("a/b")!, /Letters, digits/);
});

test("an event pattern is a non-empty JSON object", () => {
  assert.equal(validatePattern('{"source":["a"]}'), null);
  assert.match(validatePattern("")!, /Enter/);
  assert.match(validatePattern("{nope")!, /Not valid JSON/);
  assert.match(validatePattern("[1]")!, /JSON object/);
  assert.match(validatePattern("null")!, /JSON object/);
  assert.match(validatePattern("{}")!, /at least one field/);
});

test("a schedule is a rate or a cron expression, with the unit AWS expects", () => {
  for (const ok of ["rate(1 minute)", "rate(5 minutes)", "rate(2 hours)", "rate(1 day)", "cron(0 12 * * ? *)"])
    assert.equal(validateSchedule(ok), null, ok);
  assert.match(validateSchedule("rate(1 minutes)")!, /singular/);
  assert.match(validateSchedule("rate(5 minute)")!, /plural/);
  assert.match(validateSchedule("rate(0 minutes)")!, /at least 1/);
  assert.match(validateSchedule("cron(0 12 * *)")!, /six fields/);
  assert.match(validateSchedule("every day")!, /rate\(5 minutes\)/);
  assert.match(validateSchedule(" ")!, /Enter/);
});

test("a rule's trigger is its pattern on one line or its schedule", () => {
  assert.deepEqual(ruleTrigger({ EventPattern: '{\n "source": ["a"]\n}' }), {
    kind: "pattern",
    text: '{"source":["a"]}',
  });
  assert.deepEqual(ruleTrigger({ EventPattern: "not json" }), { kind: "pattern", text: "not json" });
  assert.deepEqual(ruleTrigger({ ScheduleExpression: "rate(1 day)" }), { kind: "schedule", text: "rate(1 day)" });
  assert.deepEqual(ruleTrigger({}), { kind: "none", text: "" });
});

test("a sample event is filled from the plain values of the pattern", () => {
  const e = JSON.parse(
    sampleEvent(
      '{"source":["shop"],"detail-type":["order.paid"],"detail":{"status":["failed"],"id":[{"exists":true}]}}',
    ),
  ) as Record<string, any>;
  assert.equal(e.source, "shop");
  assert.equal(e["detail-type"], "order.paid");
  assert.deepEqual(e.detail, { status: "failed" }); // a rule that is not a plain value is left to the person
  assert.equal(e.account, "000000000000");
  const dflt = JSON.parse(sampleEvent()) as Record<string, any>;
  assert.equal(dflt.source, "my.app");
  assert.equal(JSON.parse(sampleEvent("{broken")).source, "my.app");
});

test("an event's detail is an object or empty", () => {
  assert.equal(validateDetail(""), null);
  assert.equal(validateDetail('{"a":1}'), null);
  assert.match(validateDetail("[1]")!, /JSON object/);
  assert.match(validateDetail("{")!, /Not valid JSON/);
});

test("only queues, functions and topics are checked, and each needs the rule in its policy", () => {
  assert.equal(targetKind(QUEUE), "sqs");
  assert.equal(targetKind("arn:aws:lambda:us-east-1:0:function:f"), "lambda");
  assert.equal(targetKind("arn:aws:sns:us-east-1:0:t"), "sns");
  assert.equal(targetKind("arn:aws:kinesis:us-east-1:0:stream/s"), "other");
  const allow = (action: string, source = RULE) =>
    JSON.stringify({
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: action,
          Condition: { ArnEquals: { "aws:SourceArn": source } },
        },
      ],
    });
  assert.equal(targetHealth(QUEUE, { exists: true, policy: allow("sqs:SendMessage") }, RULE), "delivers");
  assert.equal(targetHealth(QUEUE, { exists: true }, RULE), "needs-permission");
  assert.equal(
    targetHealth(QUEUE, { exists: true, policy: allow("sqs:SendMessage", "arn:other") }, RULE),
    "needs-permission",
  );
  assert.equal(targetHealth(QUEUE, { exists: true, policy: allow("sns:Publish") }, RULE), "needs-permission");
  assert.equal(targetHealth(QUEUE, { exists: false }, RULE), "missing");
  assert.equal(
    targetHealth("arn:aws:sns:us-east-1:0:t", { exists: true, policy: allow("sns:Publish") }, RULE),
    "delivers",
  );
  assert.equal(targetHealth("arn:aws:kinesis:us-east-1:0:stream/s", { exists: true }, RULE), "not-checked");
  // a policy for SNS does not let EventBridge in
  const sns = JSON.stringify({
    Statement: [{ Effect: "Allow", Principal: { Service: "sns.amazonaws.com" }, Action: "sqs:SendMessage" }],
  });
  assert.equal(targetHealth(QUEUE, { exists: true, policy: sns }, RULE), "needs-permission");
});

test("ids made from names", () => {
  assert.equal(targetId(QUEUE), "audit");
  assert.equal(targetId("arn:aws:sqs:us-east-1:0:a b"), "a-b");
  assert.equal(targetId("arn:aws:lambda:us-east-1:0:function:x".padEnd(200, "y")).length <= 64, true);
  assert.equal(ruleStatementId("orders", "audit"), "events-orders-audit");
  assert.equal(ruleStatementId("a.b", "c d"), "events-a-b-c-d");
});

test("the permission statement is added once, keeps the rest of the policy and names this rule", () => {
  const o = { resourceArn: QUEUE, ruleArn: RULE, bus: "orders", rule: "audit", action: "sqs:SendMessage" } as const;
  const first = JSON.parse(addRuleToPolicy(undefined, o)) as { Statement: Record<string, any>[] };
  assert.equal(first.Statement.length, 1);
  assert.deepEqual(first.Statement[0], {
    Sid: "events-orders-audit",
    Effect: "Allow",
    Principal: { Service: "events.amazonaws.com" },
    Action: "sqs:SendMessage",
    Resource: QUEUE,
    Condition: { ArnEquals: { "aws:SourceArn": RULE } },
  });
  const other = JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "keep", Effect: "Allow" }] });
  const again = JSON.parse(addRuleToPolicy(addRuleToPolicy(other, o), o)) as { Statement: { Sid: string }[] };
  assert.deepEqual(
    again.Statement.map((s) => s.Sid),
    ["keep", "events-orders-audit"],
  );
});

test("a target links to its own screen, except what has none", () => {
  assert.equal(targetHref("/t/1", QUEUE), "/t/1/sqs/audit");
  assert.equal(targetHref("/t/1", "arn:aws:sns:us-east-1:0:my topic"), "/t/1/sns/my%20topic");
  assert.equal(targetHref("/t/1", "arn:aws:lambda:us-east-1:0:function:worker:live"), "/t/1/lambda/worker");
  assert.equal(targetHref("/t/1", "arn:aws:kinesis:us-east-1:0:stream/s"), null);
});
