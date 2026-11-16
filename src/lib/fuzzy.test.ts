import assert from "node:assert/strict";

import { test } from "vitest";

import { fuzzy, fuzzyItem } from "./fuzzy";

test("an empty query matches everything with no highlights", () => {
  assert.deepEqual(fuzzy("", "anything"), { score: 0, indices: [] });
  assert.deepEqual(fuzzy("   ", "anything"), { score: 0, indices: [] });
});

test("non-subsequences don't match", () => {
  assert.equal(fuzzy("xyz", "S3 buckets"), null);
  assert.equal(fuzzy("ba", "ab"), null); // order matters
});

test("subsequences match and report positions", () => {
  assert.deepEqual(fuzzy("s3bk", "S3 buckets")?.indices, [0, 1, 3, 6]);
  assert.ok(fuzzy("ddb", "DynamoDB")); // d..d..b
});

test("contiguous substrings outrank scattered matches", () => {
  const sub = fuzzy("buck", "S3 buckets")!;
  const scattered = fuzzy("buck", "b u c k")!;
  assert.deepEqual(sub.indices, [3, 4, 5, 6]);
  assert.ok(sub.score > scattered.score);
});

test("earlier and word-start matches rank higher", () => {
  assert.ok(fuzzy("log", "logs")!.score > fuzzy("log", "my-blog")!.score);
  assert.ok(fuzzy("fn", "my-fn")!.score > fuzzy("fn", "myfnx")!.score);
});

test("case-insensitive, and keywords match without highlights", () => {
  assert.ok(fuzzy("DYNAMO", "dynamodb tables"));
  const m = fuzzyItem("storage", "S3", "object storage")!;
  assert.deepEqual(m.indices, []);
  assert.ok(m.score < fuzzyItem("s3", "S3")!.score);
  assert.equal(fuzzyItem("zzz", "S3", "object storage"), null);
});
