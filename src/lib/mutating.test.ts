import assert from "node:assert/strict";

import { test } from "vitest";

import { isMutating, isRecordable } from "./mutating";
import { withTiming } from "./recorder-timing";

test("read-only operations are not mutating", () => {
  for (const op of [
    "ListBuckets",
    "GetObject",
    "DescribeTable",
    "Scan",
    "Query",
    "ReceiveMessage",
    "HeadObject",
    "BatchGetItem",
  ])
    assert.equal(isMutating(op), false, op);
  for (const op of ["CreateBucket", "PutItem", "DeleteQueue", "SendMessage", "Publish", "Invoke", "PurgeQueue"])
    assert.equal(isMutating(op), true, op);
});

test("Invoke is audited as mutating but never recorded", () => {
  assert.equal(isRecordable("Invoke"), false);
  assert.equal(isRecordable("CreateFunction"), true);
  assert.equal(isRecordable("ListFunctions"), false);
});

test("recorded steps get replay timing", () => {
  const base = { service: "dynamodb" as const, input: {} };
  assert.equal(withTiming({ ...base, operation: "CreateTable" }).delayAfterMs, 3000);
  assert.equal(withTiming({ ...base, operation: "PutItem" }).retries, 5);
  assert.deepEqual(withTiming({ ...base, operation: "DeleteTable" }), { ...base, operation: "DeleteTable" });
});
