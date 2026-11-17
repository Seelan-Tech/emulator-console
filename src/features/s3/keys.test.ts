import assert from "node:assert/strict";

import { test } from "vitest";

import {
  breadcrumbs,
  bucketRegionFrom,
  chunk,
  displayName,
  previewKind,
  s3Uri,
  sortObjects,
  validateBucketName,
} from "./keys";

test("breadcrumbs build cumulative prefixes", () => {
  assert.deepEqual(breadcrumbs(""), []);
  assert.deepEqual(breadcrumbs("a/b/"), [
    { name: "a", prefix: "a/" },
    { name: "b", prefix: "a/b/" },
  ]);
});

test("display names are relative to the current prefix", () => {
  assert.equal(displayName("a/b/file.txt", "a/b/"), "file.txt");
  assert.equal(displayName("file.txt", ""), "file.txt");
  assert.equal(s3Uri("bkt", "a/b.txt"), "s3://bkt/a/b.txt");
});

test("bucket name rules", () => {
  assert.equal(validateBucketName("my-bucket.01"), null);
  for (const bad of ["ab", "UpperCase", "-start", "end-", "a..b", "192.168.0.1", "x".repeat(64), "has space"])
    assert.notEqual(validateBucketName(bad), null, bad);
});

test("sorting by name, size and modified, both directions", () => {
  const rows = [
    { key: "p/b", size: 5, modified: "2026-01-02" },
    { key: "p/A", size: 9, modified: "2026-01-01" },
    { key: "p/c", size: 1, modified: "2026-01-03" },
  ];
  assert.deepEqual(
    sortObjects(rows, "name", "asc", "p/").map((r) => r.key),
    ["p/A", "p/b", "p/c"],
  );
  assert.deepEqual(
    sortObjects(rows, "size", "desc", "p/").map((r) => r.size),
    [9, 5, 1],
  );
  assert.deepEqual(
    sortObjects(rows, "modified", "asc", "p/").map((r) => r.key),
    ["p/A", "p/b", "p/c"],
  );
});

test("preview kinds and chunking", () => {
  assert.equal(previewKind("a/readme.MD"), "text");
  assert.equal(previewKind("pic.PNG"), "image");
  assert.equal(previewKind("archive.zip"), null);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("a bucket's region comes from its LocationConstraint", () => {
  assert.equal(bucketRegionFrom(null), "us-east-1");
  assert.equal(bucketRegionFrom(undefined), "us-east-1");
  assert.equal(bucketRegionFrom(""), "us-east-1");
  assert.equal(bucketRegionFrom("EU"), "eu-west-1");
  assert.equal(bucketRegionFrom("us-west-2"), "us-west-2");
});
