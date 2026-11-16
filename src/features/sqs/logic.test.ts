import assert from "node:assert/strict";

import { test } from "vitest";

import {
  counts,
  finalQueueName,
  isFifo,
  prettyBody,
  queueNameFromUrl,
  toMessageAttributes,
  validateQueueName,
} from "./logic";

test("queue names", () => {
  assert.equal(queueNameFromUrl("https://sqs.us-east-1.amazonaws.com/000000000000/my-q"), "my-q");
  assert.equal(isFifo("a.fifo"), true);
  assert.equal(finalQueueName("orders", true), "orders.fifo");
  assert.equal(finalQueueName("orders.fifo", true), "orders.fifo");
  assert.equal(finalQueueName("orders", false), "orders");
  assert.equal(validateQueueName("ok_name-1", false), null);
  assert.equal(validateQueueName("orders", true), null);
  for (const bad of ["", "has space", "dots.in.name", "x".repeat(81)])
    assert.notEqual(validateQueueName(bad, false), null, bad);
});

test("message attributes", () => {
  assert.equal(toMessageAttributes([]), undefined);
  assert.equal(toMessageAttributes([{ name: " ", type: "String", value: "x" }]), undefined);
  assert.deepEqual(
    toMessageAttributes([
      { name: "k", type: "String", value: "v" },
      { name: "n", type: "Number", value: "3" },
    ]),
    {
      k: { DataType: "String", StringValue: "v" },
      n: { DataType: "Number", StringValue: "3" },
    },
  );
  assert.throws(() => toMessageAttributes([{ name: "n", type: "Number", value: "abc" }]), /number/);
});

test("counts parse string attributes", () => {
  assert.deepEqual(counts({ ApproximateNumberOfMessages: "3", ApproximateNumberOfMessagesNotVisible: "1" }), {
    available: 3,
    inFlight: 1,
    delayed: 0,
  });
  assert.deepEqual(counts(undefined), { available: 0, inFlight: 0, delayed: 0 });
});

test("JSON bodies are pretty-printed, text is left alone", () => {
  assert.deepEqual(prettyBody('{"a":1}'), { text: '{\n  "a": 1\n}', json: true });
  assert.deepEqual(prettyBody("hello"), { text: "hello", json: false });
  assert.deepEqual(prettyBody("42"), { text: "42", json: false });
});
