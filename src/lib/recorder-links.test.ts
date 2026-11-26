import assert from "node:assert/strict";

import { test } from "vitest";

import { runSteps } from "./fixtures";
import {
  addLinked,
  generatedIds,
  literalStep,
  looksGenerated,
  removeStep,
  toFixtureSteps,
  unlink,
} from "./recorder-links";
import type { RecordedStep } from "./recorder-timing";
import { step as stepSchema } from "./schemas";

const URL = "http://localhost:9297/000000000000/orders";
const ARN = "arn:aws:sns:us-east-1:000000000000:alerts";
const queue = (): RecordedStep => ({ service: "sqs", operation: "CreateQueue", input: { QueueName: "orders" } });
const send = (url = URL): RecordedStep => ({
  service: "sqs",
  operation: "SendMessage",
  input: { QueueUrl: url, MessageBody: "hi" },
});

test("only values shaped like generated ids qualify", () => {
  for (const v of [ARN, URL, "6f1a2b3c-1111-4222-8333-444455556666", "i-0abc1234def567890", "AIDAJQABLZS4A3QDU576Q"])
    assert.equal(looksGenerated(v), true, v);
  for (const v of ["PAY_PER_REQUEST", "us-east-1", "python3.12", "orders", "ACTIVE", "my-queue-name", "12345678"])
    assert.equal(looksGenerated(v), false, v);
});

test("generatedIds lists id-shaped outputs by path, and skips what the user typed", () => {
  const out = {
    QueueUrl: URL,
    Info: { Arn: ARN, Echo: "i-0abc1234def567890" },
    List: [{ Id: "AIDAJQABLZS4A3QDU576Q" }],
  };
  assert.deepEqual(generatedIds(out, { Echo: "x" }), {
    QueueUrl: URL,
    "Info.Arn": ARN,
    "Info.Echo": "i-0abc1234def567890",
    "List[0].Id": "AIDAJQABLZS4A3QDU576Q",
  });
  assert.deepEqual(generatedIds({ QueueUrl: URL }, { QueueUrl: URL }), {});
  assert.deepEqual(generatedIds({ "Bad-Key": { A: URL } }, {}), {}); // a key the capture syntax cannot name
});

test("an id one step returned and a later step uses becomes a variable", () => {
  let steps = addLinked([], queue(), { QueueUrl: URL });
  steps = addLinked(steps, send(), {});
  assert.deepEqual(steps[0]!.capture, { queueUrl: "QueueUrl" });
  assert.deepEqual(steps[1]!.input, { QueueUrl: "{{queueUrl}}", MessageBody: "hi" });
  assert.deepEqual(steps[1]!.links, { queueUrl: URL });
  assert.deepEqual(steps[0]!.produced, { QueueUrl: URL });
});

test("an id inside longer text is linked too, in every place it appears", () => {
  let steps = addLinked([], { service: "sns", operation: "CreateTopic", input: { Name: "alerts" } }, { TopicArn: ARN });
  steps = addLinked(
    steps,
    {
      service: "sqs",
      operation: "SetQueueAttributes",
      input: { Attributes: { Policy: `{"A":"${ARN}","B":["${ARN}"]}` } },
    },
    {},
  );
  assert.deepEqual((steps[1]!.input as any).Attributes.Policy, '{"A":"{{topicArn}}","B":["{{topicArn}}"]}');
});

test("nothing is linked when linking is off, or for a value the user typed, or an ambiguous one", () => {
  const off = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {}, false);
  assert.deepEqual(off[1]!.input, send().input);
  assert.equal(off[0]!.capture, undefined);

  const typed = addLinked(
    [],
    { ...queue(), input: { QueueUrl: "http://typed.example/x" } },
    { QueueUrl: "http://typed.example/x" },
  );
  assert.equal(typed[0]!.produced, undefined);

  // the same id returned by two different steps: unclear which one was meant
  let two = addLinked([], queue(), { QueueUrl: URL });
  two = addLinked(two, queue(), { QueueUrl: URL });
  two = addLinked(two, send(), {});
  assert.deepEqual(two[2]!.input, send().input);
});

test("names are unique, and a second use reuses the capture", () => {
  let steps = addLinked([], queue(), { QueueUrl: URL });
  const other = "http://localhost:9297/000000000000/other";
  steps = addLinked(steps, queue(), { QueueUrl: other });
  steps = addLinked(steps, send(), {});
  steps = addLinked(steps, send(other), {});
  steps = addLinked(steps, send(), {});
  assert.deepEqual(steps[0]!.capture, { queueUrl: "QueueUrl" });
  assert.deepEqual(steps[1]!.capture, { queueUrl2: "QueueUrl" });
  assert.deepEqual((steps[3]!.input as any).QueueUrl, "{{queueUrl2}}");
  assert.deepEqual((steps[4]!.input as any).QueueUrl, "{{queueUrl}}");
});

test("a step with no id in it is recorded as it was", () => {
  const bucket: RecordedStep = { service: "s3", operation: "CreateBucket", input: { Bucket: "b" } };
  assert.deepEqual(addLinked([], bucket, { Location: "/b" }), [bucket]);
});

test("unlink puts the value back and drops a capture nothing else uses", () => {
  let steps = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {});
  steps = addLinked(steps, send(), {});
  const once = unlink(steps, 1, "queueUrl");
  assert.deepEqual(once[1]!.input, send().input);
  assert.equal(once[1]!.links, undefined);
  assert.deepEqual(once[0]!.capture, { queueUrl: "QueueUrl" }); // step 3 still uses it
  const twice = unlink(once, 2, "queueUrl");
  assert.equal(twice[0]!.capture, undefined);
  assert.equal(unlink(steps, 1, "nope"), steps);
});

test("removing a step that captured a value gives the value back to the steps that used it", () => {
  const steps = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {});
  const after = removeStep(steps, 0);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0]!.input, send().input);
  assert.equal(after[0]!.links, undefined);
});

test("removing the step that used a value drops the capture", () => {
  const steps = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {});
  const after = removeStep(steps, 1);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.capture, undefined);
});

test("literalStep restores values, and a fixture carries no bookkeeping", () => {
  const steps = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {});
  assert.deepEqual(literalStep(steps[1]!).input, send().input);
  const saved = toFixtureSteps(steps);
  assert.ok(saved.every((s) => !("links" in s) && !("produced" in s)));
  assert.deepEqual(saved[0]!.capture, { queueUrl: "QueueUrl" });
});

test("a linked recording replays: the second step gets the id the first call returned", async () => {
  const steps = addLinked(addLinked([], queue(), { QueueUrl: URL }), send(), {});
  const seen: unknown[] = [];
  const out = await runSteps(
    toFixtureSteps(steps).map((s) => stepSchema.parse(s)),
    async (s) => (
      seen.push(s.input),
      { ok: true, ms: 1, output: { QueueUrl: "http://other-host:1/000000000000/orders" } }
    ),
  );
  assert.equal(out.status, "succeeded");
  assert.deepEqual(seen[1], { QueueUrl: "http://other-host:1/000000000000/orders", MessageBody: "hi" });
});
