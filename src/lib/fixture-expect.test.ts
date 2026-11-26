import assert from "node:assert/strict";

import { test } from "vitest";

import { evaluateExpect } from "./fixture-expect";
import { type Expectation, expectation } from "./schemas";

const ex = (o: unknown) => expectation.parse(o);
const fails = (e: Expectation, out: unknown, service = "sqs") => evaluateExpect([e], out, service);
const out = {
  Attributes: { ApproximateNumberOfMessages: "3", Name: "orders-queue" },
  Items: [{ id: "a" }, { id: "b" }],
  Function: { State: "Active" },
};

test("equals compares deeply and strictly", () => {
  assert.deepEqual(fails(ex({ path: "Function.State", equals: "Active" }), out), []);
  assert.deepEqual(fails(ex({ path: "Items[0]", equals: { id: "a" } }), out), []);
  assert.deepEqual(fails(ex({ path: "Attributes.ApproximateNumberOfMessages", equals: 3 }), out), [
    'Attributes.ApproximateNumberOfMessages: expected 3, got "3"',
  ]);
});

test("equals null matches a null, and notEquals is the opposite", () => {
  assert.deepEqual(fails(ex({ path: "A", equals: null }), { A: null }), []);
  assert.deepEqual(fails(ex({ path: "Function.State", notEquals: "Pending" }), out), []);
  assert.equal(fails(ex({ path: "Function.State", notEquals: "Active" }), out).length, 1);
});

test("contains looks in text and in lists", () => {
  assert.deepEqual(fails(ex({ path: "Attributes.Name", contains: "orders" }), out), []);
  assert.deepEqual(fails(ex({ path: "Items", contains: { id: "b" } }), out), []);
  assert.equal(fails(ex({ path: "Items", contains: { id: "z" } }), out).length, 1);
  assert.equal(fails(ex({ path: "Function.State", contains: 5 }), out).length, 1);
  assert.equal(fails(ex({ path: "Function", contains: "Active" }), out).length, 1);
});

test("exists true needs a value, exists false needs none", () => {
  assert.deepEqual(fails(ex({ path: "Function.State", exists: true }), out), []);
  assert.deepEqual(fails(ex({ path: "Function.Nope", exists: false }), out), []);
  assert.deepEqual(fails(ex({ path: "A", exists: false }), { A: null }), []);
  assert.deepEqual(fails(ex({ path: "Function.Nope", exists: true }), out), [
    "Function.Nope: expected a value, got nothing",
  ]);
});

test("length counts a list, a text or the keys of an object", () => {
  assert.deepEqual(fails(ex({ path: "Items", length: 2 }), out), []);
  assert.deepEqual(fails(ex({ path: "Attributes.Name", length: 12 }), out), []);
  assert.deepEqual(fails(ex({ path: "Function", length: 1 }), out), []);
  assert.deepEqual(fails(ex({ path: "Items", length: 0 }), { Items: [] }), []);
  assert.equal(fails(ex({ path: "Items", length: 5 }), out).length, 1);
  assert.equal(fails(ex({ path: "Missing", length: 0 }), out).length, 1);
});

test("number comparisons accept numbers that came back as text", () => {
  const n = "Attributes.ApproximateNumberOfMessages";
  assert.deepEqual(fails(ex({ path: n, gt: 2 }), out), []);
  assert.deepEqual(fails(ex({ path: n, gte: 3 }), out), []);
  assert.deepEqual(fails(ex({ path: n, lt: 4 }), out), []);
  assert.deepEqual(fails(ex({ path: n, lte: 3 }), out), []);
  assert.equal(fails(ex({ path: n, gt: 3 }), out).length, 1);
  assert.equal(fails(ex({ path: "Attributes.Name", gt: 0 }), out).length, 1);
  assert.equal(fails(ex({ path: "Missing", lte: 5 }), out).length, 1);
  assert.equal(fails(ex({ path: "Attributes.Missing", lte: 5 }), { Attributes: { Missing: "" } }).length, 1);
});

test("matches tests text and numbers against a pattern", () => {
  assert.deepEqual(fails(ex({ path: "Attributes.Name", matches: "^orders-" }), out), []);
  assert.deepEqual(fails(ex({ path: "N", matches: "^4\\d$" }), { N: 42 }), []);
  assert.equal(fails(ex({ path: "Items", matches: "a" }), out).length, 1);
});

test("every failing check is listed, and a long value is cut", () => {
  const long = "x".repeat(300);
  const f = evaluateExpect([ex({ path: "A", equals: 1 }), ex({ path: "B", equals: 1 })], { A: 2, B: long }, "sqs");
  assert.equal(f.length, 2);
  assert.equal(f[0], "A: expected 1, got 2");
  assert.ok(f[1]!.length < 160 && f[1]!.endsWith("…"));
});

test("a failure in a service that holds secrets does not quote the response", () => {
  for (const service of ["secretsmanager", "ssm", "kms"]) {
    const f = fails(ex({ path: "SecretString", equals: "expected" }), { SecretString: "hunter2" }, service);
    assert.equal(f.length, 1);
    assert.ok(!f[0]!.includes("hunter2"));
    assert.ok(f[0]!.includes("not shown"));
  }
});

test("a check needs a path and exactly one matcher, and the pattern has to compile", () => {
  assert.ok(!expectation.safeParse({ path: "A" }).success);
  assert.ok(!expectation.safeParse({ path: "A", equals: 1, gt: 0 }).success);
  assert.ok(!expectation.safeParse({ path: "A", matches: "(" }).success);
  assert.ok(!expectation.safeParse({ path: "A b", equals: 1 }).success);
  assert.ok(!expectation.safeParse({ path: "A", equal: 1 }).success);
  assert.ok(expectation.safeParse({ path: "A", equals: null }).success);
});
