import assert from "node:assert/strict";

import { test } from "vitest";

import { cliCommand, cliOperation, cliScript } from "./cli-command";

test("operation names become CLI sub-commands", () => {
  assert.equal(cliOperation("CreateQueue"), "create-queue");
  assert.equal(cliOperation("ListObjectsV2"), "list-objects-v2");
  assert.equal(cliOperation("AssumeRoleWithSAML"), "assume-role-with-saml");
  assert.equal(cliOperation("DescribeLogGroups"), "describe-log-groups");
});

test("a call becomes one command with the input as JSON", () => {
  assert.equal(
    cliCommand({ service: "sqs", operation: "CreateQueue", input: { QueueName: "q" } }),
    `aws sqs create-queue --cli-input-json '{"QueueName":"q"}'`,
  );
  assert.equal(cliCommand({ service: "sns", operation: "ListTopics", input: {} }), "aws sns list-topics");
  assert.equal(cliCommand({ service: "sns", operation: "ListTopics" }), "aws sns list-topics");
  assert.equal(
    cliCommand({ service: "sqs", operation: "ListQueues", region: "eu-west-1" }),
    "aws sqs list-queues --region eu-west-1",
  );
});

test("services the CLI names differently", () => {
  assert.match(
    cliCommand({ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }),
    /^aws s3api create-bucket /,
  );
  assert.match(cliCommand({ service: "eventbridge", operation: "ListEventBuses" }), /^aws events list-event-buses/);
  assert.match(cliCommand({ service: "sfn", operation: "ListStateMachines" }), /^aws stepfunctions /);
  assert.match(cliCommand({ service: "logs", operation: "DescribeLogGroups" }), /^aws logs describe-log-groups/);
});

test("single quotes in the input survive the shell quoting", () => {
  const c = cliCommand({ service: "sns", operation: "Publish", input: { Message: "it's" } });
  assert.equal(c, `aws sns publish --cli-input-json '{"Message":"it'\\''s"}'`);
});

test("blobs are base64 strings", () => {
  assert.equal(
    cliCommand({
      service: "lambda",
      operation: "UpdateFunctionCode",
      input: { FunctionName: "f", ZipFile: { $base64: "UEsDBA==" } },
    }),
    `aws lambda update-function-code --cli-input-json '{"FunctionName":"f","ZipFile":"UEsDBA=="}'`,
  );
});

test("invoke uses flags (the CLI rejects --cli-input-json for it), a base64 payload and an output file", () => {
  assert.equal(
    cliCommand({
      service: "lambda",
      operation: "Invoke",
      input: { FunctionName: "f", Payload: '{"a":1}', InvocationType: "Event" },
    }),
    "aws lambda invoke --function-name 'f' --payload 'eyJhIjoxfQ==' --invocation-type 'Event' response.json",
  );
  assert.equal(
    cliCommand({ service: "lambda", operation: "Invoke", input: { FunctionName: "f" } }),
    "aws lambda invoke --function-name 'f' response.json",
  );
});

test("a script keeps the order and adds the pauses of a replay", () => {
  const s = cliScript([
    { service: "dynamodb", operation: "CreateTable", input: { TableName: "t" }, delayAfterMs: 3000 },
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" } },
  ]);
  assert.deepEqual(s.split("\n").slice(1), [
    `aws dynamodb create-table --cli-input-json '{"TableName":"t"}'`,
    "sleep 3",
    `aws sqs create-queue --cli-input-json '{"QueueName":"q"}'`,
  ]);
  assert.match(s.split("\n")[0]!, /^# /);
});
