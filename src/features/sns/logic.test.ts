import assert from "node:assert/strict";

import { test } from "vitest";

import {
  addTopicToQueuePolicy,
  arnName,
  deliversOnEmulator,
  functionPolicyAllowsTopic,
  isFifoTopic,
  lambdaStatementId,
  PROTOCOLS,
  queueArnFromUrl,
  queuePolicyAllowsTopic,
  subscriptionHealth,
  supportsRawDelivery,
} from "./logic";

const topic = "arn:aws:sns:us-east-1:000000000000:orders";
const queue = "arn:aws:sqs:us-east-1:000000000000:orders-q";

test("ARN helpers", () => {
  assert.equal(arnName(topic), "orders");
  assert.equal(isFifoTopic("a.fifo"), true);
  assert.equal(queueArnFromUrl("https://sqs.us-east-1.amazonaws.com/000000000000/orders-q", "us-east-1"), queue);
});

test("a fresh policy allows the topic to send to the queue", () => {
  const p = JSON.parse(addTopicToQueuePolicy(undefined, queue, topic));
  assert.equal(p.Statement.length, 1);
  assert.deepEqual(p.Statement[0].Condition, { ArnEquals: { "aws:SourceArn": topic } });
  assert.equal(p.Statement[0].Resource, queue);
  assert.equal(p.Statement[0].Action, "sqs:SendMessage");
});

test("existing statements are kept and the same topic is not duplicated", () => {
  const other = { Sid: "keep-me", Effect: "Allow", Principal: "*", Action: "sqs:ReceiveMessage", Resource: queue };
  const first = addTopicToQueuePolicy(JSON.stringify({ Version: "2012-10-17", Statement: [other] }), queue, topic);
  const again = JSON.parse(addTopicToQueuePolicy(first, queue, topic));
  assert.equal(again.Statement.length, 2);
  assert.ok(again.Statement.some((s: any) => s.Sid === "keep-me"));
  assert.equal(again.Statement.filter((s: any) => s.Sid === "sns-orders").length, 1);
});

test("a different topic adds a second statement", () => {
  const a = addTopicToQueuePolicy(undefined, queue, topic);
  const b = JSON.parse(addTopicToQueuePolicy(a, queue, "arn:aws:sns:us-east-1:000000000000:billing"));
  assert.deepEqual(b.Statement.map((s: any) => s.Sid).sort(), ["sns-billing", "sns-orders"]);
});

test("raw delivery only for sqs and http(s)", () => {
  assert.equal(supportsRawDelivery("sqs"), true);
  assert.equal(supportsRawDelivery("email"), false);
});

test("only sqs and lambda subscriptions deliver on the emulator", () => {
  assert.deepEqual(PROTOCOLS.filter(deliversOnEmulator), ["sqs", "lambda"]);
});

test("the Lambda permission statement id names the region and the topic, and stays a valid id", () => {
  assert.equal(lambdaStatementId("arn:aws:sns:us-west-1:000000000000:test"), "sns-us-west-1-test");
  assert.equal(lambdaStatementId("arn:aws:sns:us-east-1:000000000000:orders.fifo"), "sns-us-east-1-orders-fifo");
  assert.notEqual(
    lambdaStatementId("arn:aws:sns:us-east-1:000000000000:test"),
    lambdaStatementId("arn:aws:sns:us-west-1:000000000000:test"),
  );
  assert.ok(lambdaStatementId(`arn:aws:sns:us-east-1:000000000000:${"a".repeat(200)}`).length <= 100);
});

const sub = (Protocol: string, SubscriptionArn = "arn:aws:sns:us-east-1:000000000000:orders:1") => ({
  SubscriptionArn,
  Protocol,
  Endpoint: queue,
});
const snsStatement = (extra: Record<string, unknown> = {}) => ({
  Effect: "Allow",
  Principal: { Service: "sns.amazonaws.com" },
  Action: "sqs:SendMessage",
  Resource: queue,
  ...extra,
});
const policyOf = (...Statement: unknown[]) => JSON.stringify({ Version: "2012-10-17", Statement });

test("the policy written by the subscribe dialog passes the queue check", () => {
  assert.equal(queuePolicyAllowsTopic(addTopicToQueuePolicy(undefined, queue, topic), topic), true);
});

test("a missing, empty or unparseable queue policy does not allow the topic", () => {
  assert.equal(queuePolicyAllowsTopic(undefined, topic), false);
  assert.equal(queuePolicyAllowsTopic(policyOf(), topic), false);
  assert.equal(queuePolicyAllowsTopic("{not json", topic), false);
});

test("the queue policy must name this topic, unless the statement has no SourceArn condition", () => {
  const other = snsStatement({
    Condition: { ArnEquals: { "aws:SourceArn": "arn:aws:sns:us-east-1:000000000000:other" } },
  });
  assert.equal(queuePolicyAllowsTopic(policyOf(other), topic), false);
  assert.equal(queuePolicyAllowsTopic(policyOf(snsStatement()), topic), true);
  const like = snsStatement({ Condition: { ArnLike: { "aws:SourceArn": "arn:aws:sns:*:000000000000:ord*" } } });
  assert.equal(queuePolicyAllowsTopic(policyOf(like), topic), true);
  const many = snsStatement({ Condition: { ArnEquals: { "aws:SourceArn": ["x", topic] } } });
  assert.equal(queuePolicyAllowsTopic(policyOf(many), topic), true);
});

test("wildcard principals and actions count; other actions and a single statement object work", () => {
  assert.equal(queuePolicyAllowsTopic(policyOf(snsStatement({ Principal: "*", Action: "sqs:*" })), topic), true);
  assert.equal(queuePolicyAllowsTopic(policyOf(snsStatement({ Action: "sqs:ReceiveMessage" })), topic), false);
  assert.equal(
    queuePolicyAllowsTopic(policyOf(snsStatement({ Principal: { Service: "s3.amazonaws.com" } })), topic),
    false,
  );
  assert.equal(queuePolicyAllowsTopic(JSON.stringify({ Statement: snsStatement() }), topic), true);
});

test("an explicit Deny wins", () => {
  assert.equal(queuePolicyAllowsTopic(policyOf(snsStatement(), snsStatement({ Effect: "Deny" })), topic), false);
});

test("the function policy needs lambda:InvokeFunction for this topic", () => {
  const ok = {
    Effect: "Allow",
    Principal: { Service: "sns.amazonaws.com" },
    Action: "lambda:InvokeFunction",
    Condition: { ArnLike: { "AWS:SourceArn": topic } },
  };
  assert.equal(functionPolicyAllowsTopic(policyOf(ok), topic), true);
  assert.equal(functionPolicyAllowsTopic(policyOf({ ...ok, Action: "lambda:GetFunction" }), topic), false);
  assert.equal(functionPolicyAllowsTopic(undefined, topic), false);
});

test("health: protocols that never deliver and unconfirmed subscriptions are warnings", () => {
  assert.equal(subscriptionHealth(sub("email"), topic, undefined).status, "warn");
  assert.equal(subscriptionHealth(sub("sqs", "PendingConfirmation"), topic, { exists: true }).status, "warn");
});

test("health: sqs", () => {
  assert.equal(subscriptionHealth(sub("sqs"), topic, undefined).status, "unknown");
  assert.equal(subscriptionHealth(sub("sqs"), topic, { exists: false }).status, "error");
  const blocked = subscriptionHealth(sub("sqs"), topic, { exists: true });
  assert.deepEqual([blocked.status, blocked.fix], ["error", "queue-policy"]);
  const policy = addTopicToQueuePolicy(undefined, queue, topic);
  assert.equal(subscriptionHealth(sub("sqs"), topic, { exists: true, policy }).status, "ok");
});

test("health: lambda", () => {
  assert.equal(subscriptionHealth(sub("lambda"), topic, { exists: false }).fix, undefined);
  assert.equal(subscriptionHealth(sub("lambda"), topic, { exists: true }).fix, "lambda-permission");
  const policy = policyOf({
    Effect: "Allow",
    Principal: { Service: "sns.amazonaws.com" },
    Action: "lambda:InvokeFunction",
  });
  assert.equal(subscriptionHealth(sub("lambda"), topic, { exists: true, policy }).status, "ok");
});
