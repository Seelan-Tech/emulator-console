import assert from "node:assert/strict";

import { test } from "vitest";

import {
  addTopicToQueuePolicy,
  arnName,
  arnRegion,
  deliversOnEmulator,
  endpointProblem,
  isFifoTopic,
  lambdaStatementId,
  policyAllowsTopic,
  PROTOCOLS,
  queueArnFromUrl,
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

const T = "arn:aws:sns:us-west-1:000000000000:test";
const allow = (extra: object = {}) =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Principal: { Service: "sns.amazonaws.com" }, Action: "lambda:InvokeFunction", ...extra },
    ],
  });

test("arnRegion reads the region of an ARN", () => {
  assert.equal(arnRegion("arn:aws:lambda:eu-west-1:000000000000:function:f"), "eu-west-1");
  assert.equal(arnRegion("my-function"), undefined);
});

test("a policy allows the topic when SNS may call the action for it", () => {
  const cond = (op: string, v: string | string[]) => ({ Condition: { [op]: { "AWS:SourceArn": v } } });
  assert.equal(policyAllowsTopic(allow(cond("ArnLike", T)), T, "lambda:InvokeFunction"), true);
  assert.equal(policyAllowsTopic(allow(cond("ArnEquals", T)), T, "lambda:InvokeFunction"), true);
  assert.equal(policyAllowsTopic(allow(cond("ArnEquals", [T, "x"])), T, "lambda:InvokeFunction"), true);
  assert.equal(policyAllowsTopic(allow(cond("ArnLike", "arn:aws:sns:*:*:test")), T, "lambda:InvokeFunction"), true);
  // no source condition (or only an account condition): any topic
  assert.equal(policyAllowsTopic(allow(), T, "lambda:InvokeFunction"), true);
  assert.equal(
    policyAllowsTopic(
      allow({ Condition: { StringEquals: { "AWS:SourceAccount": "000000000000" } } }),
      T,
      "lambda:InvokeFunction",
    ),
    true,
  );
  assert.equal(policyAllowsTopic(allow({ Action: ["lambda:*"] }), T, "lambda:InvokeFunction"), true);
  assert.equal(policyAllowsTopic(allow({ Principal: "*" }), T, "lambda:InvokeFunction"), true);
});

test("a policy does not allow the topic when it names another topic, action or principal, or is missing", () => {
  const other = { Condition: { ArnLike: { "AWS:SourceArn": "arn:aws:sns:us-west-1:000000000000:other" } } };
  assert.equal(policyAllowsTopic(allow(other), T, "lambda:InvokeFunction"), false);
  assert.equal(policyAllowsTopic(allow({ Action: "lambda:GetFunction" }), T, "lambda:InvokeFunction"), false);
  assert.equal(
    policyAllowsTopic(allow({ Principal: { Service: "s3.amazonaws.com" } }), T, "lambda:InvokeFunction"),
    false,
  );
  assert.equal(policyAllowsTopic(allow({ Effect: "Deny" }), T, "lambda:InvokeFunction"), false);
  assert.equal(policyAllowsTopic(undefined, T, "lambda:InvokeFunction"), false);
  assert.equal(policyAllowsTopic("{not json", T, "lambda:InvokeFunction"), false);
});

test("the policy written by addTopicToQueuePolicy is recognised as allowing the topic", () => {
  const q = "arn:aws:sqs:us-west-1:000000000000:q";
  assert.equal(policyAllowsTopic(addTopicToQueuePolicy(undefined, q, T), T, "sqs:SendMessage"), true);
  assert.equal(
    policyAllowsTopic(
      addTopicToQueuePolicy(undefined, q, T),
      "arn:aws:sns:us-west-1:000000000000:other",
      "sqs:SendMessage",
    ),
    false,
  );
});

test("subscription health: missing endpoint, no permission, permission", () => {
  assert.equal(subscriptionHealth("lambda", { exists: false }, T), "missing");
  assert.equal(subscriptionHealth("lambda", { exists: true }, T), "needs-permission");
  assert.equal(subscriptionHealth("lambda", { exists: true, policy: allow() }, T), "delivers");
  // the action depends on the protocol
  assert.equal(subscriptionHealth("sqs", { exists: true, policy: allow() }, T), "needs-permission");
});

test("endpointProblem explains what an http or https endpoint is missing", () => {
  assert.equal(endpointProblem("http", "http://localhost:8080/hook?a=1&b=2"), undefined);
  assert.equal(endpointProblem("https", "HTTPS://example.com/h"), undefined);
  assert.equal(endpointProblem("http", "  http://example.com/h "), undefined); // trimmed before sending
  assert.equal(endpointProblem("http", ""), undefined); // nothing typed yet
  assert.match(endpointProblem("http", "example.com/hook")!, /starts with http:\/\//);
  assert.match(endpointProblem("http", "localhost:8080/hook")!, /starts with http:\/\//);
  assert.match(endpointProblem("http", "https://example.com/h")!, /choose the https protocol/);
  assert.match(endpointProblem("https", "http://example.com/h")!, /choose the http protocol/);
  assert.match(endpointProblem("http", "ftp://example.com/h")!, /ftp:\/\/ is not supported/);
  assert.match(endpointProblem("http", "http://")!, /not a valid URL/);
  // other protocols are not judged here
  assert.equal(endpointProblem("sqs", "arn:aws:sqs:us-east-1:000000000000:q"), undefined);
  assert.equal(endpointProblem("email", "nobody"), undefined);
});
