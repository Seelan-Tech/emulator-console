import assert from "node:assert/strict";

import { test } from "vitest";

import {
  bundleFile,
  FileError,
  fileSlug,
  fixtureFile,
  freeName,
  parseFixtureFile,
  planImport,
  secretSteps,
} from "./fixture-file";

const f = (name: string, steps: unknown[] = []) => ({ name, description: `about ${name}`, steps });
const bad = (raw: string) => assert.throws(() => parseFixtureFile(raw), FileError);

test("a fixture file reads back the same, is indented and ends with a newline", () => {
  const text = fixtureFile(f("orders", [{ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }]));
  assert.ok(text.endsWith("}\n"));
  assert.match(text, /^{\n {2}"format": "emulator-console-fixture",\n {2}"version": 1,\n {2}"name": "orders"/);
  assert.deepEqual(parseFixtureFile(text), [
    {
      name: "orders",
      description: "about orders",
      steps: [{ service: "s3", operation: "CreateBucket", input: { Bucket: "b" } }],
    },
  ]);
});

test("a bundle holds several fixtures, sorted by name", () => {
  const text = bundleFile([f("b"), f("a"), f("c")]);
  assert.deepEqual(
    parseFixtureFile(text).map((x) => (x as { name: string }).name),
    ["a", "b", "c"],
  );
});

test("a file that is not a fixture file says why", () => {
  bad("{nope");
  bad("[]");
  bad("null");
  bad('{"name":"x","steps":[]}'); // no format: a fixture copied from the API is not a file
  bad('{"format":"emulator-console-fixture"}'); // no version
  bad('{"format":"emulator-console-fixture","version":"1"}');
  bad('{"format":"emulator-console-fixtures","version":1}'); // no list
  bad(`{"format":"emulator-console-fixture","version":1,"pad":"${"x".repeat(5_000_001)}"}`);
  assert.throws(() => parseFixtureFile('{"format":"emulator-console-fixture","version":2,"steps":[]}'), /version 2/);
});

test("a file name is made of letters, digits and dashes", () => {
  assert.equal(fileSlug("Orders baseline / v2"), "orders-baseline-v2");
  assert.equal(fileSlug("  !!  "), "fixture");
  assert.equal(fileSlug("é"), "fixture");
  assert.ok(fileSlug("x".repeat(100)).length <= 60);
});

test("steps with values that may be secret are named", () => {
  const found = secretSteps([
    { service: "s3", operation: "CreateBucket", input: { Bucket: "b" } },
    { service: "secretsmanager", operation: "CreateSecret", input: { Name: "n", SecretString: "x" } },
    { service: "secretsmanager", operation: "CreateSecret", input: { Name: "empty" } },
    { service: "ssm", operation: "PutParameter", input: { Name: "p", Value: "v", Type: "String" } },
    { service: "ssm", operation: "PutParameter", input: { Name: "p", Value: "v", Type: "SecureString" } },
    { service: "lambda", operation: "CreateFunction", input: { Environment: { Variables: { KEY: "v" } } } },
    { service: "lambda", operation: "CreateFunction", input: { Environment: { Variables: {} } } },
    { service: "iam", operation: "CreateLoginProfile", input: { UserName: "u", Password: "p" } },
    null,
    { service: "sqs" },
  ]);
  assert.deepEqual(found, [
    { step: 2, call: "secretsmanager.CreateSecret", what: "a secret value" },
    { step: 5, call: "ssm.PutParameter", what: "a secure parameter value" },
    { step: 6, call: "lambda.CreateFunction", what: "environment variables" },
    { step: 8, call: "iam.CreateLoginProfile", what: "a password" },
  ]);
});

test("an import creates new names and renames, replaces or skips the ones that exist", () => {
  const existing = new Set(["orders", "orders (2)"]);
  assert.deepEqual(planImport(["new", "orders"], existing, "rename"), [
    { name: "new", action: "create" },
    { name: "orders (3)", action: "rename" },
  ]);
  assert.deepEqual(planImport(["new", "orders"], existing, "replace"), [
    { name: "new", action: "create" },
    { name: "orders", action: "replace" },
  ]);
  assert.deepEqual(planImport(["orders"], existing, "skip"), [{ name: "orders", action: "skip" }]);
});

test("renamed fixtures of one import do not take each other's names", () => {
  assert.deepEqual(planImport(["a", "b"], new Set(["a", "b", "a (2)"]), "rename"), [
    { name: "a (3)", action: "rename" },
    { name: "b (2)", action: "rename" },
  ]);
});

test("a renamed name still fits in 100 characters", () => {
  const long = "x".repeat(100);
  const free = freeName(long, new Set([long]));
  assert.equal(free.length, 100);
  assert.ok(free.endsWith(" (2)"));
});
