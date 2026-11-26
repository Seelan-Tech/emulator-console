import assert from "node:assert/strict";

import { test } from "vitest";

import { operations } from "./aws";
import { checkSteps, type Lookups } from "./fixture-check";
import type { Field } from "./schema";
import { operationInput } from "./schema";

const real: Lookups = { operations: (s) => operations(s as never), input: (s, o) => operationInput(s as never, o) };
const check = (steps: unknown[]) => checkSteps(steps, real);
const messages = (ps: Awaited<ReturnType<typeof check>>) => ps.map((p) => `${p.step + 1} ${p.level}: ${p.message}`);

test("a fixture that is fine has no problems", async () => {
  const problems = await check([
    { service: "s3", operation: "CreateBucket", input: { Bucket: "b" } },
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" }, capture: { url: "QueueUrl" } },
    { service: "sqs", operation: "DeleteQueue", input: { QueueUrl: "{{url}}" } },
  ]);
  assert.deepEqual(messages(problems), []);
});

test("an unknown operation, a missing required field and a field of the wrong kind are errors", async () => {
  const problems = await check([
    { service: "s3", operation: "MakeBucket", input: {} },
    { service: "s3", operation: "CreateBucket", input: {} },
    { service: "sqs", operation: "SendMessage", input: { QueueUrl: 5, MessageBody: "x" } },
    { service: "dynamodb", operation: "CreateTable", input: { TableName: "t", KeySchema: "id" } },
  ]);
  assert.deepEqual(messages(problems).slice(0, 3), [
    "1 error: s3 has no operation MakeBucket",
    "2 error: Bucket is required",
    "3 error: QueueUrl should be a string, not a number",
  ]);
  assert.ok(messages(problems).some((m) => m.startsWith("4 error: KeySchema should be a list")));
});

test("a field the operation does not have is a warning, nested ones included", async () => {
  const problems = await check([
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q", Queue: "typo" } },
  ]);
  assert.deepEqual(messages(problems), ["1 warning: Queue is not a field of this operation (it is ignored)"]);
});

test("a placeholder stands in for any value", async () => {
  const problems = await check([
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" }, capture: { url: "QueueUrl" } },
    { service: "sqs", operation: "ReceiveMessage", input: { QueueUrl: "{{url}}", MaxNumberOfMessages: "{{url}}" } },
  ]);
  assert.deepEqual(messages(problems), []);
});

test("a variable must be captured by an earlier step", async () => {
  const problems = await check([
    { service: "sqs", operation: "DeleteQueue", input: { QueueUrl: "{{url}}" } },
    { service: "sqs", operation: "DeleteQueue", input: { QueueUrl: "{{later}}" } },
    { service: "sqs", operation: "CreateQueue", input: { QueueName: "q" }, capture: { later: "QueueUrl" } },
  ]);
  assert.deepEqual(messages(problems), [
    "1 error: uses {{url}}, which no step captures",
    "2 error: uses {{later}}, which step 3 captures later",
  ]);
});

test("steps that send again, and a delete that undoes a create, are warnings", async () => {
  const problems = await check([
    { service: "s3", operation: "CreateBucket", input: { Bucket: "b" } },
    { service: "sns", operation: "Publish", input: { TopicArn: "arn:aws:sns:us-east-1:000000000000:t", Message: "m" } },
    { service: "s3", operation: "DeleteBucket", input: { Bucket: "b" } },
    { service: "s3", operation: "DeleteBucket", input: { Bucket: "other" } },
  ]);
  assert.deepEqual(messages(problems), [
    "2 warning: Publish sends again on every replay",
    "3 warning: undoes step 1 (CreateBucket): both run on every replay",
  ]);
});

test("a step that is not a valid step is reported with the reason", async () => {
  const problems = await check([
    { service: "nope", operation: "X" },
    { operation: "Y" },
    { service: "s3", operation: "X Y" },
  ]);
  assert.deepEqual(
    problems.map((p) => p.step),
    [0, 1, 2],
  );
  assert.ok(problems.every((p) => p.level === "error"));
});

test("operations that are not modelled as a form are left alone", async () => {
  const field: Field = { kind: "document" };
  const problems = await checkSteps([{ service: "s3", operation: "Anything", input: { a: 1 } }], {
    operations: async () => ["Anything"],
    input: async () => field,
  });
  assert.deepEqual(problems, []);
});
