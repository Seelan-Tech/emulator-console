import assert from "node:assert/strict";

import { test } from "vitest";

import {
  addTopicToQueuePolicy,
  arnName,
  deliversOnEmulator,
  isFifoTopic,
  lambdaStatementId,
  PROTOCOLS,
  queueArnFromUrl,
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
